import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  commentsTable,
  contentReportsTable,
  db,
  friendRequestsTable,
  friendshipsTable,
  notificationsTable,
  roomInvitesTable,
  quotesTable,
  userBlocksTable,
  userHighlightsTable,
  usersTable,
} from "@workspace/db";
import {
  BlockUserBody,
  BlockUserParams,
  GetBlockedUsersParams,
  GetModerationReportsQueryParams,
  ReportContentBody,
  UpdateModerationReportBody,
  UpdateModerationReportParams,
  UnblockUserParams,
} from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate.js";
import { getViewer, visibilityPredicate } from "../lib/social";

const router: IRouter = Router();
// Jude (@bookworm) is the only moderator. This account ID is the same in the
// development and production databases; checking the ID prevents a future
// user who reclaims the handle from inheriting moderator access.
const MODERATOR_ACCOUNT_ID = 59;

function hasModeratorAccess(userId: number): boolean {
  return userId === MODERATOR_ACCOUNT_ID;
}

router.get(
  "/users/:userId/blocked-users",
  authenticate,
  async (req, res): Promise<void> => {
    const params = GetBlockedUsersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (req.userId !== params.data.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const rows = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        nickname: usersTable.nickname,
        avatarUrl: usersTable.avatarUrl,
        avatarColor: usersTable.avatarColor,
        blockedAt: userBlocksTable.createdAt,
      })
      .from(userBlocksTable)
      .innerJoin(usersTable, eq(userBlocksTable.blockedId, usersTable.id))
      .where(eq(userBlocksTable.blockerId, req.userId))
      .orderBy(desc(userBlocksTable.createdAt));

    res.json(
      rows.map((row) => ({
        ...row,
        nickname: row.nickname ?? null,
        avatarUrl: row.avatarUrl ?? null,
        blockedAt: row.blockedAt.toISOString(),
      })),
    );
  },
);

router.post(
  "/users/:userId/blocks",
  authenticate,
  async (req, res): Promise<void> => {
    const params = BlockUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = BlockUserBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const blockerId = params.data.userId;
    const blockedId = body.data.blockedUserId;
    if (req.userId !== blockerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (blockerId === blockedId) {
      res.status(400).json({ error: "Cannot block yourself" });
      return;
    }

    const [blockedUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, blockedId))
      .limit(1);
    if (!blockedUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(userBlocksTable)
        .values({ blockerId, blockedId })
        .onConflictDoNothing();

      const pairFollows = or(
        and(
          eq(friendshipsTable.userId, blockerId),
          eq(friendshipsTable.friendId, blockedId),
        ),
        and(
          eq(friendshipsTable.userId, blockedId),
          eq(friendshipsTable.friendId, blockerId),
        ),
      )!;
      await tx.delete(friendshipsTable).where(pairFollows);

      const pairRequests = or(
        and(
          eq(friendRequestsTable.requesterId, blockerId),
          eq(friendRequestsTable.recipientId, blockedId),
        ),
        and(
          eq(friendRequestsTable.requesterId, blockedId),
          eq(friendRequestsTable.recipientId, blockerId),
        ),
      )!;
      await tx.delete(friendRequestsTable).where(pairRequests);

      const pairNotifications = or(
        and(
          eq(notificationsTable.userId, blockerId),
          eq(notificationsTable.actorId, blockedId),
        ),
        and(
          eq(notificationsTable.userId, blockedId),
          eq(notificationsTable.actorId, blockerId),
        ),
      )!;
      await tx.delete(notificationsTable).where(pairNotifications);

      const pairInvites = or(
        and(
          eq(roomInvitesTable.inviterId, blockerId),
          eq(roomInvitesTable.inviteeId, blockedId),
        ),
        and(
          eq(roomInvitesTable.inviterId, blockedId),
          eq(roomInvitesTable.inviteeId, blockerId),
        ),
      )!;
      await tx.delete(roomInvitesTable).where(pairInvites);
    });

    const [row] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        nickname: usersTable.nickname,
        avatarUrl: usersTable.avatarUrl,
        avatarColor: usersTable.avatarColor,
        blockedAt: userBlocksTable.createdAt,
      })
      .from(userBlocksTable)
      .innerJoin(usersTable, eq(userBlocksTable.blockedId, usersTable.id))
      .where(
        and(
          eq(userBlocksTable.blockerId, blockerId),
          eq(userBlocksTable.blockedId, blockedId),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(500).json({ error: "Block could not be saved" });
      return;
    }
    res.json({
      ...row,
      nickname: row.nickname ?? null,
      avatarUrl: row.avatarUrl ?? null,
      blockedAt: row.blockedAt.toISOString(),
    });
  },
);

router.delete(
  "/users/:userId/blocks/:blockedUserId",
  authenticate,
  async (req, res): Promise<void> => {
    const params = UnblockUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (req.userId !== params.data.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await db
      .delete(userBlocksTable)
      .where(
        and(
          eq(userBlocksTable.blockerId, params.data.userId),
          eq(userBlocksTable.blockedId, params.data.blockedUserId),
        ),
      );
    res.sendStatus(204);
  },
);

router.get("/moderation/access", authenticate, async (req, res): Promise<void> => {
  res.json({ isModerator: hasModeratorAccess(req.userId) });
});

router.get(
  "/moderation/reports",
  authenticate,
  async (req, res): Promise<void> => {
    if (!hasModeratorAccess(req.userId)) {
      res.status(403).json({ error: "Moderator access required" });
      return;
    }

    const query = GetModerationReportsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const reportRows = await db
      .select()
      .from(contentReportsTable)
      .where(eq(contentReportsTable.status, query.data.status))
      .orderBy(desc(contentReportsTable.createdAt))
      .limit(query.data.limit);

    if (reportRows.length === 0) {
      res.json([]);
      return;
    }

    const commentIds = [
      ...new Set(
        reportRows
          .filter((report) => report.targetType === "comment")
          .map((report) => report.targetId),
      ),
    ];
    const highlightIds = [
      ...new Set(
        reportRows
          .filter((report) => report.targetType === "highlight")
          .map((report) => report.targetId),
      ),
    ];
    const reportedUserIds = [
      ...new Set(
        reportRows
          .filter((report) => report.targetType === "user")
          .map((report) => report.targetId),
      ),
    ];

    const commentRows = commentIds.length
      ? await db
          .select({
            id: commentsTable.id,
            userId: commentsTable.userId,
            text: commentsTable.text,
          })
          .from(commentsTable)
          .where(inArray(commentsTable.id, commentIds))
      : [];
    const highlightRows = highlightIds.length
      ? await db
          .select({
            id: userHighlightsTable.id,
            userId: userHighlightsTable.userId,
            text: quotesTable.text,
          })
          .from(userHighlightsTable)
          .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
          .where(inArray(userHighlightsTable.id, highlightIds))
      : [];
    const reportedUsers = reportedUserIds.length
      ? await db
          .select({
            id: usersTable.id,
            username: usersTable.username,
            nickname: usersTable.nickname,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, reportedUserIds))
      : [];

    const targetDetails = new Map<
      string,
      { userId: number; preview: string | null }
    >();
    for (const comment of commentRows) {
      targetDetails.set(`comment:${comment.id}`, {
        userId: comment.userId,
        preview: comment.text.slice(0, 600),
      });
    }
    for (const highlight of highlightRows) {
      targetDetails.set(`highlight:${highlight.id}`, {
        userId: highlight.userId,
        preview: highlight.text.slice(0, 600),
      });
    }
    for (const user of reportedUsers) {
      targetDetails.set(`user:${user.id}`, {
        userId: user.id,
        preview: null,
      });
    }

    const reporterIds = reportRows.map((report) => report.reporterId);
    const relatedUserIds = [
      ...new Set([
        ...reporterIds,
        ...[...targetDetails.values()].map((target) => target.userId),
      ]),
    ];
    const relatedUsers = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        nickname: usersTable.nickname,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, relatedUserIds));
    const usersById = new Map(relatedUsers.map((user) => [user.id, user]));

    res.json(
      reportRows.map((report) => {
        const target = targetDetails.get(`${report.targetType}:${report.targetId}`);
        return {
          id: report.id,
          targetType: report.targetType,
          targetId: report.targetId,
          reason: report.reason,
          details: report.details,
          status: report.status,
          createdAt: report.createdAt.toISOString(),
          reporter: usersById.get(report.reporterId) ?? null,
          targetAuthor: target ? usersById.get(target.userId) ?? null : null,
          targetPreview: target?.preview ?? null,
        };
      }),
    );
  },
);

router.patch(
  "/moderation/reports/:reportId",
  authenticate,
  async (req, res): Promise<void> => {
    if (!hasModeratorAccess(req.userId)) {
      res.status(403).json({ error: "Moderator access required" });
      return;
    }

    const params = UpdateModerationReportParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateModerationReportBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [updated] = await db
      .update(contentReportsTable)
      .set({ status: body.data.status })
      .where(eq(contentReportsTable.id, params.data.reportId))
      .returning({
        id: contentReportsTable.id,
        status: contentReportsTable.status,
      });

    if (!updated) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    res.json({ ok: true, reportId: updated.id, status: updated.status });
  },
);

router.post("/reports", authenticate, async (req, res): Promise<void> => {
  const body = ReportContentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { targetType, targetId, reason, details } = body.data;
  if (targetType === "user" && targetId === req.userId) {
    res.status(400).json({ error: "Cannot report yourself" });
    return;
  }

  if (targetType === "user") {
    const [target] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, targetId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
  } else {
    const viewer = await getViewer(req.userId);
    if (targetType === "comment") {
      const [target] = await db
        .select({ id: commentsTable.id, userId: commentsTable.userId })
        .from(commentsTable)
        .where(
          and(
            eq(commentsTable.id, targetId),
            visibilityPredicate(
              commentsTable.visibility,
              commentsTable.userId,
              viewer,
              commentsTable.roomId,
              true,
            ),
          ),
        )
        .limit(1);
      if (!target) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }
      if (target.userId === req.userId) {
        res.status(400).json({ error: "Cannot report your own content" });
        return;
      }
    } else {
      const [target] = await db
        .select({
          id: userHighlightsTable.id,
          userId: userHighlightsTable.userId,
        })
        .from(userHighlightsTable)
        .where(
          and(
            eq(userHighlightsTable.id, targetId),
            visibilityPredicate(
              userHighlightsTable.visibility,
              userHighlightsTable.userId,
              viewer,
              userHighlightsTable.roomId,
              true,
            ),
          ),
        )
        .limit(1);
      if (!target) {
        res.status(404).json({ error: "Highlight not found" });
        return;
      }
      if (target.userId === req.userId) {
        res.status(400).json({ error: "Cannot report your own content" });
        return;
      }
    }
  }

  const inserted = await db
    .insert(contentReportsTable)
    .values({
      reporterId: req.userId,
      targetType,
      targetId,
      reason,
      details: details?.trim() || null,
    })
    .onConflictDoNothing()
    .returning({ id: contentReportsTable.id });

  res.json({ ok: true, alreadyReported: inserted.length === 0 });
});

export default router;
