import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  db,
  booksTable,
  commentsTable,
  commentLikesTable,
  highlightLikesTable,
  notificationsTable,
  quotesTable,
  readingRoomsTable,
  roomInvitesTable,
  roomMembersTable,
  userHighlightsTable,
  userLibraryTable,
  usersTable,
} from "@workspace/db";
import {
  ListRoomsQueryParams,
  CreateRoomBody,
  GetMyRoomsQueryParams,
  GetRoomParams,
  UpdateRoomParams,
  UpdateRoomBody,
  JoinRoomParams,
  LeaveRoomParams,
  RemoveRoomMemberParams,
  InviteToRoomParams,
  InviteToRoomBody,
  AcceptRoomInviteParams,
  DeclineRoomInviteParams,
  GetRoomFeedParams,
  GetBookRoomsParams,
} from "@workspace/api-zod";
import type { Room, RoomDetail, RoomFeedItem } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate.js";
import { createRoomInviteNotification } from "../lib/notifications";
import { getOwnedBookIds, truncateQuoteText } from "../lib/contentLimits";
import { getMutualFriendIds } from "../lib/social";

const router: IRouter = Router();

/**
 * Builds Room DTOs for a set of room rows: joins the canonical book and
 * aggregates member counts in two batched queries (no N+1), and flags
 * membership for the viewer.
 */
async function toRoomDtos(
  rooms: (typeof readingRoomsTable.$inferSelect)[],
  viewerId?: number,
): Promise<Room[]> {
  if (rooms.length === 0) return [];
  const bookIds = [...new Set(rooms.map((r) => r.canonicalBookId))];
  const roomIds = rooms.map((r) => r.id);

  const [books, memberCounts, myMemberships] = await Promise.all([
    db.select().from(booksTable).where(inArray(booksTable.id, bookIds)),
    db
      .select({ roomId: roomMembersTable.roomId, c: count() })
      .from(roomMembersTable)
      .where(inArray(roomMembersTable.roomId, roomIds))
      .groupBy(roomMembersTable.roomId),
    viewerId != null
      ? db
          .select({ roomId: roomMembersTable.roomId })
          .from(roomMembersTable)
          .where(
            and(
              inArray(roomMembersTable.roomId, roomIds),
              eq(roomMembersTable.userId, viewerId),
            ),
          )
      : Promise.resolve([]),
  ]);

  const bookMap = new Map(books.map((b) => [b.id, b]));
  const countMap = new Map(memberCounts.map((m) => [m.roomId, Number(m.c)]));
  const mySet = new Set(myMemberships.map((m) => m.roomId));

  return rooms.map((r) => {
    const book = bookMap.get(r.canonicalBookId);
    return {
      id: r.id,
      canonicalBookId: r.canonicalBookId,
      name: r.name,
      description: r.description,
      isPublic: r.isPublic,
      ownerId: r.ownerId,
      memberCount: countMap.get(r.id) ?? 0,
      bookTitle: book?.title ?? "Unknown book",
      bookAuthor: book?.author ?? "",
      coverColor: book?.coverColor ?? "#B85C38",
      isMember: mySet.has(r.id),
      createdAt: r.createdAt,
    };
  });
}

// GET /rooms?q= — browse/search PUBLIC rooms by room name or book title.
router.get("/rooms", authenticate, async (req, res): Promise<void> => {
  const query = ListRoomsQueryParams.safeParse(req.query);
  const q = query.success ? query.data.q?.trim() : undefined;

  const base = and(
    eq(readingRoomsTable.isPublic, true),
    isNotNull(readingRoomsTable.ownerId),
  );
  const rooms = q
    ? await db
        .select({ room: readingRoomsTable })
        .from(readingRoomsTable)
        .innerJoin(
          booksTable,
          eq(readingRoomsTable.canonicalBookId, booksTable.id),
        )
        .where(
          and(
            base,
            or(
              ilike(readingRoomsTable.name, `%${q}%`),
              ilike(booksTable.title, `%${q}%`),
            ),
          ),
        )
        .orderBy(desc(readingRoomsTable.createdAt))
        .limit(50)
        .then((rows) => rows.map((r) => r.room))
    : await db
        .select()
        .from(readingRoomsTable)
        .where(base)
        .orderBy(desc(readingRoomsTable.createdAt))
        .limit(50);

  res.json(await toRoomDtos(rooms, req.userId));
});

// POST /rooms — create a room; the creator becomes the owner-member.
router.post("/rooms", authenticate, async (req, res): Promise<void> => {
  const body = CreateRoomBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [book] = await db
    .select()
    .from(booksTable)
    .where(eq(booksTable.id, body.data.canonicalBookId));
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  // Room + owner membership must never end up in a partial state.
  const room = await db.transaction(async (tx) => {
    const [activeAccount] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, req.userId),
          eq(usersTable.deletionPending, false),
        ),
      )
      .for("share");
    if (!activeAccount) return null;
    const [created] = await tx
      .insert(readingRoomsTable)
      .values({
        canonicalBookId: body.data.canonicalBookId,
        name: body.data.name.trim(),
        description: body.data.description?.trim() ?? "",
        isPublic: body.data.isPublic,
        ownerId: req.userId,
      })
      .returning();
    if (!created) throw new Error("Failed to create room");
    await tx.insert(roomMembersTable).values({
      roomId: created.id,
      userId: req.userId,
      role: "owner",
    });
    return created;
  });
  if (!room) {
    res.status(409).json({ error: "Account deletion is in progress" });
    return;
  }

  const [dto] = await toRoomDtos([room], req.userId);
  res.status(201).json(dto);
});

// GET /rooms/trending — public rooms ranked by recent activity:
// 2 x (members joined in the last 7 days) + (room comments in the last 7 days).
// MUST be registered before /rooms/:roomId.
router.get("/rooms/trending", authenticate, async (req, res): Promise<void> => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recentJoins, recentComments, publicRooms] = await Promise.all([
    db
      .select({ roomId: roomMembersTable.roomId, c: count() })
      .from(roomMembersTable)
      .where(gte(roomMembersTable.createdAt, since))
      .groupBy(roomMembersTable.roomId),
    db
      .select({ roomId: commentsTable.roomId, c: count() })
      .from(commentsTable)
      .where(
        and(
          sql`${commentsTable.roomId} IS NOT NULL`,
          gte(commentsTable.createdAt, since),
        ),
      )
      .groupBy(commentsTable.roomId),
    db
      .select()
      .from(readingRoomsTable)
      .where(
        and(
          eq(readingRoomsTable.isPublic, true),
          isNotNull(readingRoomsTable.ownerId),
        ),
      ),
  ]);

  const scores = new Map<number, number>();
  for (const j of recentJoins)
    scores.set(j.roomId, (scores.get(j.roomId) ?? 0) + 2 * Number(j.c));
  for (const c of recentComments) {
    if (c.roomId == null) continue;
    scores.set(c.roomId, (scores.get(c.roomId) ?? 0) + Number(c.c));
  }

  const ranked = publicRooms
    .map((r) => ({ room: r, score: scores.get(r.id) ?? 0 }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.room.createdAt.getTime() - a.room.createdAt.getTime(),
    )
    .slice(0, 10)
    .map((r) => r.room);

  res.json(await toRoomDtos(ranked, req.userId));
});

// GET /rooms/mine?bookId= — the viewer's rooms (optionally per book, for the
// reader scope picker). MUST be registered before /rooms/:roomId.
router.get("/rooms/mine", authenticate, async (req, res): Promise<void> => {
  const query = GetMyRoomsQueryParams.safeParse(req.query);
  const bookId = query.success ? query.data.bookId : undefined;

  const filters = [eq(roomMembersTable.userId, req.userId)];
  if (bookId != null)
    filters.push(eq(readingRoomsTable.canonicalBookId, bookId));

  const rows = await db
    .select({ room: readingRoomsTable })
    .from(roomMembersTable)
    .innerJoin(
      readingRoomsTable,
      eq(roomMembersTable.roomId, readingRoomsTable.id),
    )
    .where(and(...filters))
    .orderBy(desc(readingRoomsTable.createdAt));

  res.json(await toRoomDtos(rows.map((r) => r.room), req.userId));
});

/** Loads a room row or undefined. */
async function getRoomRow(
  roomId: number,
): Promise<typeof readingRoomsTable.$inferSelect | undefined> {
  const [room] = await db
    .select()
    .from(readingRoomsTable)
    .where(eq(readingRoomsTable.id, roomId));
  return room;
}

/** The viewer's membership row for a room, or undefined. */
async function getMembership(
  roomId: number,
  userId: number,
): Promise<typeof roomMembersTable.$inferSelect | undefined> {
  const [m] = await db
    .select()
    .from(roomMembersTable)
    .where(
      and(
        eq(roomMembersTable.roomId, roomId),
        eq(roomMembersTable.userId, userId),
      ),
    );
  return m;
}

/** Whether the viewer has a pending invite to the room. */
async function hasPendingInvite(
  roomId: number,
  userId: number,
): Promise<boolean> {
  const [inv] = await db
    .select({ id: roomInvitesTable.id })
    .from(roomInvitesTable)
    .where(
      and(
        eq(roomInvitesTable.roomId, roomId),
        eq(roomInvitesTable.inviteeId, userId),
      ),
    );
  return inv != null;
}

async function hasArchivedRoomContribution(
  roomId: number,
  userId: number,
): Promise<boolean> {
  const [comment] = await db
    .select({ id: commentsTable.id })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.roomId, roomId),
        eq(commentsTable.userId, userId),
      ),
    )
    .limit(1);
  if (comment) return true;
  const [highlight] = await db
    .select({ id: userHighlightsTable.id })
    .from(userHighlightsTable)
    .where(
      and(
        eq(userHighlightsTable.roomId, roomId),
        eq(userHighlightsTable.userId, userId),
      ),
    )
    .limit(1);
  return highlight != null;
}

// GET /rooms/:roomId — room home. Private rooms are 404 to outsiders (no
// existence leak) but visible to members, pending invitees, and former
// contributors of archived rooms.
router.get("/rooms/:roomId", authenticate, async (req, res): Promise<void> => {
  const params = GetRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const room = await getRoomRow(params.data.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const [membership, invitePending] = await Promise.all([
    getMembership(room.id, req.userId),
    hasPendingInvite(room.id, req.userId),
  ]);
  const archivedContribution =
    room.ownerId == null && room.isPublic
      ? await hasArchivedRoomContribution(room.id, req.userId)
      : false;
  if (!room.isPublic && !membership && !invitePending && !archivedContribution) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  // Members + their reading progress in this book (best entry per user).
  const memberRows = await db
    .select({
      userId: roomMembersTable.userId,
      role: roomMembersTable.role,
      username: usersTable.username,
      nickname: usersTable.nickname,
      avatarUrl: usersTable.avatarUrl,
      avatarColor: usersTable.avatarColor,
      joinedAt: roomMembersTable.createdAt,
    })
    .from(roomMembersTable)
    .innerJoin(usersTable, eq(roomMembersTable.userId, usersTable.id))
    .where(eq(roomMembersTable.roomId, room.id));

  const memberIds = memberRows.map((m) => m.userId);
  const progressRows = memberIds.length
    ? await db
        .select({
          userId: userLibraryTable.userId,
          progress: sql<number | null>`max(${userLibraryTable.readingProgress})`,
        })
        .from(userLibraryTable)
        .where(
          and(
            inArray(userLibraryTable.userId, memberIds),
            eq(userLibraryTable.canonicalBookId, room.canonicalBookId),
          ),
        )
        .groupBy(userLibraryTable.userId)
    : [];
  const progressMap = new Map(
    progressRows.map((p) => [p.userId, p.progress != null ? Number(p.progress) : null]),
  );

  // The viewer's own library entry for this book (to open the reader).
  const [myEntry] = await db
    .select({
      id: userLibraryTable.id,
      readingProgress: userLibraryTable.readingProgress,
    })
    .from(userLibraryTable)
    .where(
      and(
        eq(userLibraryTable.userId, req.userId),
        eq(userLibraryTable.canonicalBookId, room.canonicalBookId),
      ),
    )
    .orderBy(
      sql`${userLibraryTable.lastOpenedAt} DESC NULLS LAST`,
      desc(userLibraryTable.id),
    )
    .limit(1);

  const [dto] = await toRoomDtos([room], req.userId);
  const members = memberRows
    .map((m) => ({
      userId: m.userId,
      username: m.username,
      nickname: m.nickname ?? null,
      avatarUrl: m.avatarUrl ?? null,
      avatarColor: m.avatarColor,
      role: m.role,
      readingProgress: progressMap.get(m.userId) ?? null,
      joinedAt: m.joinedAt,
    }))
    // Owner first, then by join date.
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    })
    .map(({ joinedAt: _joinedAt, ...rest }) => rest);

  const result: RoomDetail = {
    ...dto!,
    members,
    isMember: membership != null,
    myRole: membership?.role ?? null,
    invitePending,
    myLibraryId: myEntry?.id ?? null,
    myReadingProgress: myEntry?.readingProgress ?? null,
  };
  res.json(result);
});

// PATCH /rooms/:roomId — owner-only edits to name/description/privacy.
router.patch("/rooms/:roomId", authenticate, async (req, res): Promise<void> => {
  const params = UpdateRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateRoomBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const room = await getRoomRow(params.data.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (room.ownerId !== req.userId) {
    res.status(403).json({ error: "Only the owner can update the room" });
    return;
  }

  const [updated] = await db
    .update(readingRoomsTable)
    .set({
      ...(body.data.name != null ? { name: body.data.name.trim() } : {}),
      ...(body.data.description != null
        ? { description: body.data.description.trim() }
        : {}),
      ...(body.data.isPublic != null ? { isPublic: body.data.isPublic } : {}),
    })
    .where(eq(readingRoomsTable.id, room.id))
    .returning();

  const [dto] = await toRoomDtos([updated!], req.userId);
  res.json(dto);
});

// POST /rooms/:roomId/join — join a PUBLIC room (idempotent).
router.post("/rooms/:roomId/join", authenticate, async (req, res): Promise<void> => {
  const params = JoinRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [room] = await tx
      .select({
        id: readingRoomsTable.id,
        isPublic: readingRoomsTable.isPublic,
        ownerId: readingRoomsTable.ownerId,
      })
      .from(readingRoomsTable)
      .where(eq(readingRoomsTable.id, params.data.roomId))
      .for("update");
    if (!room) return "missing" as const;
    if (room.ownerId == null) return "archived" as const;
    if (!room.isPublic) {
      const [invite] = await tx
        .select({ id: roomInvitesTable.id })
        .from(roomInvitesTable)
        .where(
          and(
            eq(roomInvitesTable.roomId, room.id),
            eq(roomInvitesTable.inviteeId, req.userId),
          ),
        )
        .limit(1);
      if (!invite) return "forbidden" as const;
    }
    await tx
      .insert(roomMembersTable)
      .values({ roomId: room.id, userId: req.userId, role: "member" })
      .onConflictDoNothing();
    // Joining consumes any pending invite.
    await tx
      .delete(roomInvitesTable)
      .where(
        and(
          eq(roomInvitesTable.roomId, room.id),
          eq(roomInvitesTable.inviteeId, req.userId),
        ),
      );
    return "joined" as const;
  });

  if (outcome === "missing") {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (outcome === "archived") {
    res.status(404).json({ error: "Room is archived and cannot accept new members" });
    return;
  }
  if (outcome === "forbidden") {
    res.status(403).json({ error: "This room is invite-only" });
    return;
  }
  res.json({ ok: true });
});

// POST /rooms/:roomId/leave — the owner cannot leave their own room.
router.post("/rooms/:roomId/leave", authenticate, async (req, res): Promise<void> => {
  const params = LeaveRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [room] = await tx
      .select({ id: readingRoomsTable.id })
      .from(readingRoomsTable)
      .where(eq(readingRoomsTable.id, params.data.roomId))
      .for("update");
    if (!room) return "missing" as const;
    const [membership] = await tx
      .select({ id: roomMembersTable.id, role: roomMembersTable.role })
      .from(roomMembersTable)
      .where(
        and(
          eq(roomMembersTable.roomId, room.id),
          eq(roomMembersTable.userId, req.userId),
        ),
      )
      .limit(1);
    if (!membership) return "not-member" as const;
    if (membership.role === "owner") return "owner" as const;
    await tx
      .delete(roomMembersTable)
      .where(eq(roomMembersTable.id, membership.id));
    return "left" as const;
  });
  if (outcome === "missing" || outcome === "not-member") {
    res.status(404).json({ error: "Not a member of this room" });
    return;
  }
  if (outcome === "owner") {
    res.status(400).json({ error: "The owner cannot leave their own room" });
    return;
  }
  res.json({ ok: true });
});

// DELETE /rooms/:roomId/members/:userId — owner removes a member.
router.delete(
  "/rooms/:roomId/members/:userId",
  authenticate,
  async (req, res): Promise<void> => {
    const params = RemoveRoomMemberParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [room] = await tx
        .select({ id: readingRoomsTable.id, ownerId: readingRoomsTable.ownerId })
        .from(readingRoomsTable)
        .where(eq(readingRoomsTable.id, params.data.roomId))
        .for("update");
      if (!room) return "missing-room" as const;
      if (room.ownerId !== req.userId) return "forbidden" as const;
      if (params.data.userId === room.ownerId) return "owner" as const;
      const deleted = await tx
        .delete(roomMembersTable)
        .where(
          and(
            eq(roomMembersTable.roomId, room.id),
            eq(roomMembersTable.userId, params.data.userId),
          ),
        )
        .returning({ id: roomMembersTable.id });
      return deleted.length > 0 ? "removed" as const : "missing-member" as const;
    });
    if (outcome === "missing-room") {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (outcome === "forbidden") {
      res.status(403).json({ error: "Only the owner can remove members" });
      return;
    }
    if (outcome === "owner") {
      res.status(400).json({ error: "The owner cannot be removed" });
      return;
    }
    if (outcome === "missing-member") {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// POST /rooms/:roomId/invites — any member invites a FRIEND (mutual follow).
// Idempotent while pending; already-members return ok without side effects.
router.post("/rooms/:roomId/invites", authenticate, async (req, res): Promise<void> => {
  const params = InviteToRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = InviteToRoomBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const inviteeId = body.data.userId;
  if (inviteeId === req.userId) {
    res.status(400).json({ error: "Cannot invite yourself" });
    return;
  }

  const room = await getRoomRow(params.data.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const membership = await getMembership(room.id, req.userId);
  if (!membership && room.ownerId !== req.userId) {
    res.status(403).json({ error: "Only room members or the owner can invite" });
    return;
  }

  const [invitee] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, inviteeId));
  if (!invitee) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Invites are limited to friends — mirrors who you can see in the picker.
  const mutualIds = await getMutualFriendIds(req.userId);
  if (!mutualIds.includes(inviteeId)) {
    res.status(403).json({ error: "You can only invite friends" });
    return;
  }

  // Already a member? Nothing to do.
  const existingMembership = await getMembership(room.id, inviteeId);
  if (existingMembership) {
    res.json({ ok: true });
    return;
  }

  // Race-free insert; only notify when a NEW pending invite was created.
  const inserted = await db
    .insert(roomInvitesTable)
    .values({ roomId: room.id, inviterId: req.userId, inviteeId })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    try {
      await createRoomInviteNotification({
        inviteeId,
        inviterId: req.userId,
        roomId: room.id,
        roomName: room.name,
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to create room invite notification");
    }
  }

  res.json({ ok: true });
});

// POST /rooms/:roomId/invites/accept — invitee joins; the invite row is
// consumed and the invite notification card resolved, all-or-nothing.
router.post(
  "/rooms/:roomId/invites/accept",
  authenticate,
  async (req, res): Promise<void> => {
    const params = AcceptRoomInviteParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const accepted = await db.transaction(async (tx) => {
      const [room] = await tx
        .select({ id: readingRoomsTable.id, ownerId: readingRoomsTable.ownerId })
        .from(readingRoomsTable)
        .where(eq(readingRoomsTable.id, params.data.roomId))
        .for("update");
      if (!room || room.ownerId == null) return false;
      const deleted = await tx
        .delete(roomInvitesTable)
        .where(
          and(
            eq(roomInvitesTable.roomId, params.data.roomId),
            eq(roomInvitesTable.inviteeId, req.userId),
          ),
        )
        .returning();
      if (deleted.length === 0) return false;

      await tx
        .insert(roomMembersTable)
        .values({
          roomId: params.data.roomId,
          userId: req.userId,
          role: "member",
        })
        .onConflictDoNothing();

      // The invite card is now resolved — mark it read.
      await tx
        .update(notificationsTable)
        .set({ read: true })
        .where(
          and(
            eq(notificationsTable.userId, req.userId),
            eq(notificationsTable.roomId, params.data.roomId),
            eq(notificationsTable.type, "room_invite"),
          ),
        );

      return true;
    });

    if (!accepted) {
      res.status(404).json({ error: "No pending invite for this room" });
      return;
    }
    res.json({ ok: true });
  },
);

// POST /rooms/:roomId/invites/decline — silent delete; can be re-invited.
router.post(
  "/rooms/:roomId/invites/decline",
  authenticate,
  async (req, res): Promise<void> => {
    const params = DeclineRoomInviteParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const declined = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(roomInvitesTable)
        .where(
          and(
            eq(roomInvitesTable.roomId, params.data.roomId),
            eq(roomInvitesTable.inviteeId, req.userId),
          ),
        )
        .returning();
      if (deleted.length === 0) return false;

      // Resolve the notification card quietly.
      await tx
        .update(notificationsTable)
        .set({ read: true })
        .where(
          and(
            eq(notificationsTable.userId, req.userId),
            eq(notificationsTable.roomId, params.data.roomId),
            eq(notificationsTable.type, "room_invite"),
          ),
        );

      return true;
    });

    if (!declined) {
      res.status(404).json({ error: "No pending invite for this room" });
      return;
    }
    res.json({ ok: true });
  },
);

// GET /rooms/:roomId/feed — latest room-scoped highlights + comments; archived
// rooms remain readable to their former contributors.
router.get("/rooms/:roomId/feed", authenticate, async (req, res): Promise<void> => {
  const params = GetRoomFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const room = await getRoomRow(params.data.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const membership = await getMembership(room.id, req.userId);
  const archivedContribution =
    room.ownerId == null && room.isPublic
      ? await hasArchivedRoomContribution(room.id, req.userId)
      : false;
  if (!membership && !archivedContribution) {
    res.status(403).json({ error: "Members only" });
    return;
  }

  const [highlights, comments] = await Promise.all([
    db
      .select({
        id: userHighlightsTable.id,
        userId: userHighlightsTable.userId,
        username: usersTable.username,
        nickname: usersTable.nickname,
        avatarUrl: usersTable.avatarUrl,
        avatarColor: usersTable.avatarColor,
        quoteId: userHighlightsTable.quoteId,
        quoteText: quotesTable.text,
        authorProgress: userHighlightsTable.authorProgress,
        createdAt: userHighlightsTable.createdAt,
      })
      .from(userHighlightsTable)
      .innerJoin(usersTable, eq(userHighlightsTable.userId, usersTable.id))
      .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
      .where(eq(userHighlightsTable.roomId, room.id))
      .orderBy(desc(userHighlightsTable.createdAt))
      .limit(50),
    db
      .select({
        id: commentsTable.id,
        userId: commentsTable.userId,
        username: usersTable.username,
        nickname: usersTable.nickname,
        avatarUrl: usersTable.avatarUrl,
        avatarColor: usersTable.avatarColor,
        quoteId: commentsTable.quoteId,
        quoteText: quotesTable.text,
        commentText: commentsTable.text,
        likeCount: commentsTable.likeCount,
        containsSpoilers: commentsTable.containsSpoilers,
        authorProgress: commentsTable.authorProgress,
        createdAt: commentsTable.createdAt,
      })
      .from(commentsTable)
      .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
      .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
      .where(eq(commentsTable.roomId, room.id))
      .orderBy(desc(commentsTable.createdAt))
      .limit(50),
  ]);

  const [highlightLikes, commentLikes, ownsBook] = await Promise.all([
    highlights.length
      ? db
          .select({
            highlightId: highlightLikesTable.highlightId,
            userId: highlightLikesTable.userId,
          })
          .from(highlightLikesTable)
          .where(
            inArray(
              highlightLikesTable.highlightId,
              highlights.map((h) => h.id),
            ),
          )
      : Promise.resolve([]),
    comments.length
      ? db
          .select({ commentId: commentLikesTable.commentId })
          .from(commentLikesTable)
          .where(
            and(
              inArray(
                commentLikesTable.commentId,
                comments.map((c) => c.id),
              ),
              eq(commentLikesTable.userId, req.userId),
            ),
          )
      : Promise.resolve([]),
    getOwnedBookIds(req.userId, [room.canonicalBookId]).then((s) =>
      s.has(room.canonicalBookId),
    ),
  ]);

  const highlightLikeCounts = new Map<number, number>();
  const highlightLikedByMe = new Set<number>();
  for (const l of highlightLikes) {
    highlightLikeCounts.set(
      l.highlightId,
      (highlightLikeCounts.get(l.highlightId) ?? 0) + 1,
    );
    if (l.userId === req.userId) highlightLikedByMe.add(l.highlightId);
  }
  const commentLikedByMe = new Set(commentLikes.map((c) => c.commentId));

  const quoteTextFor = (text: string) => {
    if (ownsBook) return { text, truncated: false };
    return truncateQuoteText(text);
  };

  const items: RoomFeedItem[] = [
    ...highlights.map((h): RoomFeedItem => {
      const qt = quoteTextFor(h.quoteText);
      return {
        type: "highlight",
        id: h.id,
        userId: h.userId,
        username: h.username,
        nickname: h.nickname ?? null,
        avatarUrl: h.avatarUrl ?? null,
        avatarColor: h.avatarColor,
        quoteId: h.quoteId,
        quoteText: qt.text,
        quoteTextTruncated: qt.truncated,
        likeCount: highlightLikeCounts.get(h.id) ?? 0,
        likedByMe: highlightLikedByMe.has(h.id),
        containsSpoilers: false,
        authorProgress: h.authorProgress ?? null,
        createdAt: h.createdAt,
      };
    }),
    ...comments.map((c): RoomFeedItem => {
      const qt = quoteTextFor(c.quoteText);
      return {
        type: "comment",
        id: c.id,
        userId: c.userId,
        username: c.username,
        nickname: c.nickname ?? null,
        avatarUrl: c.avatarUrl ?? null,
        avatarColor: c.avatarColor,
        quoteId: c.quoteId,
        quoteText: qt.text,
        quoteTextTruncated: qt.truncated,
        commentText: c.commentText,
        likeCount: c.likeCount,
        likedByMe: commentLikedByMe.has(c.id),
        containsSpoilers: c.containsSpoilers,
        authorProgress: c.authorProgress ?? null,
        createdAt: c.createdAt,
      };
    }),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 50);

  res.json(items);
});

// GET /books/:bookId/rooms — public rooms for a book + the viewer's own rooms
// for it (even private ones), for the book detail screen.
router.get("/books/:bookId/rooms", authenticate, async (req, res): Promise<void> => {
  const params = GetBookRoomsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rooms = await db
    .select()
    .from(readingRoomsTable)
    .where(eq(readingRoomsTable.canonicalBookId, params.data.bookId))
    .orderBy(desc(readingRoomsTable.createdAt));

  const dtos = await toRoomDtos(rooms, req.userId);
  // Private rooms only surface to their own members.
  res.json(dtos.filter((r) => r.ownerId != null && (r.isPublic || r.isMember)));
});

export default router;
