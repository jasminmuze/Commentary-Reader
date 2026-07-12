import { Router, type IRouter } from "express";
import { eq, and, like, inArray, count, desc, max } from "drizzle-orm";
import {
  db,
  usersTable,
  friendshipsTable,
  friendRequestsTable,
  commentsTable,
  commentSavesTable,
  quotesTable,
  userHighlightsTable,
  booksTable,
} from "@workspace/db";
import {
  CreateUserBody,
  GetUserParams,
  GetFriendsParams,
  AddFriendParams,
  AddFriendBody,
  RemoveFriendParams,
  GetSavedCommentsParams,
  SearchUsersQueryParams,
  GetUserProfileParams,
  UpdateUserSettingsParams,
  UpdateUserSettingsBody,
  GetNotificationSettingsParams,
  UpdateNotificationSettingsParams,
  UpdateNotificationSettingsBody,
  GetUserRecordsParams,
  GetUserBookRecordsParams,
  GetUserHighlightsParams,
} from "@workspace/api-zod";
import type { UserRecordsBook, UserHighlightItem } from "@workspace/api-zod";
import bcrypt from "bcryptjs";
import { LoginUserBody } from "@workspace/api-zod";
import { formatComment } from "../lib/queries";
import {
  getViewer,
  isFollowing,
  visibilityPredicate,
} from "../lib/social";
import { createToken } from "../lib/auth.js";
import { authenticate } from "../middlewares/authenticate.js";

const AVATAR_COLORS = [
  "#E8A020", "#4A9EFF", "#FF6B6B", "#7CB9A8", "#C084FC",
  "#FB923C", "#34D399", "#F472B6", "#60A5FA", "#A78BFA",
];

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

// Pre-computed hash of a random value; used to equalize login timing on
// unknown usernames (see /users/login).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("timing-equalizer-dummy", 10);

const router: IRouter = Router();

router.post("/users", async (req, res): Promise<void> => {
  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, body.data.username));
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(body.data.password, 10);
  const [user] = await db.insert(usersTable).values({
    username: body.data.username,
    passwordHash,
    avatarColor: randomAvatarColor(),
  }).returning();

  res.json({ id: user!.id, username: user!.username, avatarColor: user!.avatarColor, defaultVisibility: user!.defaultVisibility, createdAt: user!.createdAt.toISOString(), token: createToken(user!.id) });
});

router.post("/users/login", async (req, res): Promise<void> => {
  const body = LoginUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, body.data.username));
  // Accounts without a password hash (legacy/seeded demo users) cannot log in.
  // Always run a bcrypt compare (against a dummy hash on miss) so response
  // timing doesn't reveal whether the username exists.
  const hashToCheck = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const compared = await bcrypt.compare(body.data.password, hashToCheck);
  const valid = user?.passwordHash != null && compared;
  if (!user || !valid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  res.json({ id: user.id, username: user.username, avatarColor: user.avatarColor, defaultVisibility: user.defaultVisibility, createdAt: user.createdAt.toISOString(), token: createToken(user.id) });
});

router.get("/users/search", authenticate, async (req, res): Promise<void> => {
  const params = SearchUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { q } = params.data;
  const userId = req.userId;

  const users = await db
    .select()
    .from(usersTable)
    .where(like(usersTable.username, `%${q}%`))
    .limit(20);

  const results = await Promise.all(
    users
      .filter((u) => u.id !== userId)
      .map(async (u) => {
        const isFriend = userId
          ? (await db.select().from(friendshipsTable).where(and(eq(friendshipsTable.userId, userId), eq(friendshipsTable.friendId, u.id)))).length > 0
          : false;
        return {
          id: u.id,
          username: u.username,
          avatarColor: u.avatarColor,
          createdAt: u.createdAt.toISOString(),
          isFriend,
        };
      })
  );

  res.json(results);
});

router.get("/users/:userId", authenticate, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ id: user.id, username: user.username, avatarColor: user.avatarColor, defaultVisibility: user.defaultVisibility, createdAt: user.createdAt.toISOString() });
});

// Public profile with follower/following + activity counts and the viewer's
// relationship to this user. Counts are visibility-gated to the viewer.
router.get("/users/:userId/profile", authenticate, async (req, res): Promise<void> => {
  const params = GetUserProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const targetId = params.data.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const viewer = await getViewer(req.userId);
  const isMe = req.userId === targetId;

  const [followerRow] = await db
    .select({ c: count() })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.friendId, targetId));
  const [followingRow] = await db
    .select({ c: count() })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.userId, targetId));
  const [highlightRow] = await db
    .select({ c: count() })
    .from(userHighlightsTable)
    .where(
      and(
        eq(userHighlightsTable.userId, targetId),
        visibilityPredicate(
          userHighlightsTable.visibility,
          userHighlightsTable.userId,
          viewer,
        ),
      ),
    );
  const [commentRow] = await db
    .select({ c: count() })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.userId, targetId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    );

  const isFollowedByMe = isMe ? false : await isFollowing(req.userId, targetId);
  const followsMe = isMe ? false : await isFollowing(targetId, req.userId);

  // Friend status: friends = mutual follow; otherwise check pending requests.
  let friendStatus: "none" | "requested" | "incoming" | "friends" = "none";
  if (!isMe) {
    if (isFollowedByMe && followsMe) {
      friendStatus = "friends";
    } else {
      const [outgoing] = await db
        .select({ id: friendRequestsTable.id })
        .from(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.requesterId, req.userId),
            eq(friendRequestsTable.recipientId, targetId),
          ),
        );
      if (outgoing) {
        friendStatus = "requested";
      } else {
        const [incoming] = await db
          .select({ id: friendRequestsTable.id })
          .from(friendRequestsTable)
          .where(
            and(
              eq(friendRequestsTable.requesterId, targetId),
              eq(friendRequestsTable.recipientId, req.userId),
            ),
          );
        if (incoming) friendStatus = "incoming";
      }
    }
  }

  res.json({
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt.toISOString(),
    followerCount: Number(followerRow?.c ?? 0),
    followingCount: Number(followingRow?.c ?? 0),
    highlightCount: Number(highlightRow?.c ?? 0),
    commentCount: Number(commentRow?.c ?? 0),
    isFollowedByMe,
    followsMe,
    isMe,
    friendStatus,
  });
});

// Update the current user's personal settings (self only).
router.patch("/users/:userId/settings", authenticate, async (req, res): Promise<void> => {
  const params = UpdateUserSettingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = UpdateUserSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ defaultVisibility: body.data.defaultVisibility })
    .where(eq(usersTable.id, params.data.userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ id: user.id, username: user.username, avatarColor: user.avatarColor, defaultVisibility: user.defaultVisibility, createdAt: user.createdAt.toISOString() });
});

// Get the current user's per-type notification settings (self only).
router.get("/users/:userId/notification-settings", authenticate, async (req, res): Promise<void> => {
  const params = GetNotificationSettingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [user] = await db
    .select({
      notifyLikes: usersTable.notifyLikes,
      notifyReplies: usersTable.notifyReplies,
      notifyMentions: usersTable.notifyMentions,
      notifyFriends: usersTable.notifyFriends,
    })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    likes: user.notifyLikes,
    replies: user.notifyReplies,
    mentions: user.notifyMentions,
    friends: user.notifyFriends,
  });
});

// Update the current user's per-type notification settings (self only).
// A disabled type skips BOTH in-app notification creation and push delivery.
router.put("/users/:userId/notification-settings", authenticate, async (req, res): Promise<void> => {
  const params = UpdateNotificationSettingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = UpdateNotificationSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({
      notifyLikes: body.data.likes,
      notifyReplies: body.data.replies,
      notifyMentions: body.data.mentions,
      notifyFriends: body.data.friends,
    })
    .where(eq(usersTable.id, params.data.userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    likes: user.notifyLikes,
    replies: user.notifyReplies,
    mentions: user.notifyMentions,
    friends: user.notifyFriends,
  });
});

router.get("/users/:userId/friends", authenticate, async (req, res): Promise<void> => {
  const params = GetFriendsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const friendships = await db.select({ friendId: friendshipsTable.friendId }).from(friendshipsTable).where(eq(friendshipsTable.userId, params.data.userId));
  if (friendships.length === 0) {
    res.json([]);
    return;
  }

  const friendIds = friendships.map((f) => f.friendId);
  const friends = await db.select().from(usersTable);
  const filtered = friends.filter((u) => friendIds.includes(u.id));
  res.json(filtered.map((u) => ({ id: u.id, username: u.username, avatarColor: u.avatarColor, defaultVisibility: u.defaultVisibility, createdAt: u.createdAt.toISOString() })));
});

router.post("/users/:userId/friends", authenticate, async (req, res): Promise<void> => {
  const params = AddFriendParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = AddFriendBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { userId } = params.data;
  const { friendId } = body.data;

  if (userId === friendId) {
    res.status(400).json({ error: "Cannot follow yourself" });
    return;
  }

  const [friend] = await db.select().from(usersTable).where(eq(usersTable.id, friendId));
  if (!friend) {
    res.status(404).json({ error: "Friend not found" });
    return;
  }

  // Directional follow: a single row (userId follows friendId). No reverse row.
  // Validate the target exists first so we never persist an orphan follow edge.
  await db
    .insert(friendshipsTable)
    .values({ userId, friendId })
    .onConflictDoNothing();

  res.json({ id: friend.id, username: friend.username, avatarColor: friend.avatarColor, defaultVisibility: friend.defaultVisibility, createdAt: friend.createdAt.toISOString() });
});

router.delete("/users/:userId/friends/:friendId", authenticate, async (req, res): Promise<void> => {
  const params = RemoveFriendParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { userId, friendId } = params.data;
  // Directional unfollow: remove only the (userId -> friendId) row.
  await db.delete(friendshipsTable).where(and(eq(friendshipsTable.userId, userId), eq(friendshipsTable.friendId, friendId)));
  res.sendStatus(204);
});

router.get("/users/:userId/saved-comments", authenticate, async (req, res): Promise<void> => {
  const params = GetSavedCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { userId } = params.data;
  const saves = await db.select({ commentId: commentSavesTable.commentId }).from(commentSavesTable).where(eq(commentSavesTable.userId, userId));

  if (saves.length === 0) {
    res.json([]);
    return;
  }

  const commentIds = saves.map((s) => s.commentId);
  // Re-apply visibility on read: a comment saved while public may since have
  // turned private/friends-only, so never return text the viewer can't see.
  const viewer = await getViewer(userId);
  const comments = await db
    .select()
    .from(commentsTable)
    .where(
      and(
        inArray(commentsTable.id, commentIds),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    );

  const quoteIds = [...new Set(comments.map((c) => c.quoteId))];
  const quotes = quoteIds.length
    ? await db.select().from(quotesTable).where(inArray(quotesTable.id, quoteIds))
    : [];
  const quoteTextById = new Map(quotes.map((q) => [q.id, q.text]));

  const result = await Promise.all(
    comments.map((c) =>
      formatComment(c, userId, quoteTextById.get(c.quoteId)),
    ),
  );

  res.json(result);
});

// My records grouped by book: my highlight/comment/saved counts per canonical
// book, ordered by most recent activity. Self-only.
router.get("/users/:userId/records", authenticate, async (req, res): Promise<void> => {
  const params = GetUserRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const userId = params.data.userId;

  const highlightRows = await db
    .select({
      bookId: quotesTable.canonicalBookId,
      c: count(),
      latest: max(userHighlightsTable.createdAt),
    })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .where(eq(userHighlightsTable.userId, userId))
    .groupBy(quotesTable.canonicalBookId);

  const commentRows = await db
    .select({
      bookId: quotesTable.canonicalBookId,
      c: count(),
      latest: max(commentsTable.createdAt),
    })
    .from(commentsTable)
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(eq(commentsTable.userId, userId))
    .groupBy(quotesTable.canonicalBookId);

  // Saved comments are other people's comments, so re-apply visibility on
  // read (mirrors /users/:userId/saved-comments): never count text the
  // viewer can no longer see.
  const viewer = await getViewer(userId);
  const savedRows = await db
    .select({
      bookId: quotesTable.canonicalBookId,
      c: count(),
      latest: max(commentSavesTable.createdAt),
    })
    .from(commentSavesTable)
    .innerJoin(commentsTable, eq(commentSavesTable.commentId, commentsTable.id))
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(commentSavesTable.userId, userId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    )
    .groupBy(quotesTable.canonicalBookId);

  const agg = new Map<
    number,
    { highlightCount: number; commentCount: number; savedCount: number; latest: number }
  >();
  const bump = (
    bookId: number,
    key: "highlightCount" | "commentCount" | "savedCount",
    c: number,
    latest: Date | null,
  ) => {
    const cur =
      agg.get(bookId) ??
      { highlightCount: 0, commentCount: 0, savedCount: 0, latest: 0 };
    cur[key] += c;
    if (latest) cur.latest = Math.max(cur.latest, latest.getTime());
    agg.set(bookId, cur);
  };
  for (const r of highlightRows) bump(r.bookId, "highlightCount", Number(r.c), r.latest);
  for (const r of commentRows) bump(r.bookId, "commentCount", Number(r.c), r.latest);
  for (const r of savedRows) bump(r.bookId, "savedCount", Number(r.c), r.latest);

  const bookIds = [...agg.keys()];
  const books = bookIds.length
    ? await db.select().from(booksTable).where(inArray(booksTable.id, bookIds))
    : [];
  const bookById = new Map(books.map((b) => [b.id, b]));

  const result: UserRecordsBook[] = bookIds
    .filter((id) => bookById.has(id))
    .sort((a, b) => (agg.get(b)!.latest - agg.get(a)!.latest))
    .map((id) => {
      const book = bookById.get(id)!;
      const a = agg.get(id)!;
      return {
        bookId: id,
        title: book.title,
        author: book.author,
        coverColor: book.coverColor,
        highlightCount: a.highlightCount,
        commentCount: a.commentCount,
        savedCount: a.savedCount,
      };
    });

  res.json(result);
});

// My highlights / comments / saved comments for one book. Self-only.
router.get("/users/:userId/records/:bookId", authenticate, async (req, res): Promise<void> => {
  const params = GetUserBookRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { userId, bookId } = params.data;

  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, bookId));
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const highlightRows = await db
    .select({
      id: userHighlightsTable.id,
      quoteId: userHighlightsTable.quoteId,
      quoteText: quotesTable.text,
      createdAt: userHighlightsTable.createdAt,
    })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(userHighlightsTable.userId, userId),
        eq(quotesTable.canonicalBookId, bookId),
      ),
    )
    .orderBy(desc(userHighlightsTable.createdAt));

  const highlights: UserHighlightItem[] = highlightRows.map((h) => ({
    id: h.id,
    quoteId: h.quoteId,
    bookId,
    bookTitle: book.title,
    bookAuthor: book.author,
    coverColor: book.coverColor,
    quoteText: h.quoteText,
    createdAt: h.createdAt,
  }));

  const myCommentRows = await db
    .select({ comment: commentsTable, quoteText: quotesTable.text })
    .from(commentsTable)
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(commentsTable.userId, userId),
        eq(quotesTable.canonicalBookId, bookId),
      ),
    )
    .orderBy(desc(commentsTable.createdAt));
  const comments = await Promise.all(
    myCommentRows.map((r) => formatComment(r.comment, userId, r.quoteText)),
  );

  // Saved comments: re-apply visibility on read (see saved-comments route).
  const viewer = await getViewer(userId);
  const savedCommentRows = await db
    .select({ comment: commentsTable, quoteText: quotesTable.text })
    .from(commentSavesTable)
    .innerJoin(commentsTable, eq(commentSavesTable.commentId, commentsTable.id))
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(commentSavesTable.userId, userId),
        eq(quotesTable.canonicalBookId, bookId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    )
    .orderBy(desc(commentSavesTable.createdAt));
  const savedComments = await Promise.all(
    savedCommentRows.map((r) => formatComment(r.comment, userId, r.quoteText)),
  );

  res.json({
    book: {
      bookId,
      title: book.title,
      author: book.author,
      coverColor: book.coverColor,
      highlightCount: highlights.length,
      commentCount: comments.length,
      savedCount: savedComments.length,
    },
    highlights,
    comments,
    savedComments,
  });
});

// All my highlights across books, newest first. Self-only.
router.get("/users/:userId/highlights", authenticate, async (req, res): Promise<void> => {
  const params = GetUserHighlightsParams.safeParse(req.params);
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
      id: userHighlightsTable.id,
      quoteId: userHighlightsTable.quoteId,
      bookId: quotesTable.canonicalBookId,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      coverColor: booksTable.coverColor,
      quoteText: quotesTable.text,
      createdAt: userHighlightsTable.createdAt,
    })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .innerJoin(booksTable, eq(quotesTable.canonicalBookId, booksTable.id))
    .where(eq(userHighlightsTable.userId, params.data.userId))
    .orderBy(desc(userHighlightsTable.createdAt));

  const result: UserHighlightItem[] = rows.map((r) => ({
    id: r.id,
    quoteId: r.quoteId,
    bookId: r.bookId,
    bookTitle: r.bookTitle,
    bookAuthor: r.bookAuthor,
    coverColor: r.coverColor,
    quoteText: r.quoteText,
    createdAt: r.createdAt,
  }));

  res.json(result);
});

export default router;
