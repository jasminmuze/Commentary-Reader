import { Router, type IRouter } from "express";
import { eq, and, like, inArray, count } from "drizzle-orm";
import {
  db,
  usersTable,
  friendshipsTable,
  commentsTable,
  commentSavesTable,
  quotesTable,
  userHighlightsTable,
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
} from "@workspace/api-zod";
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

const router: IRouter = Router();

router.post("/users", async (req, res): Promise<void> => {
  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, body.data.username));
  if (existing.length > 0) {
    const user = existing[0]!;
    res.json({ id: user.id, username: user.username, avatarColor: user.avatarColor, defaultVisibility: user.defaultVisibility, createdAt: user.createdAt.toISOString(), token: createToken(user.id) });
    return;
  }

  const [user] = await db.insert(usersTable).values({
    username: body.data.username,
    avatarColor: randomAvatarColor(),
  }).returning();

  res.json({ id: user!.id, username: user!.username, avatarColor: user!.avatarColor, defaultVisibility: user!.defaultVisibility, createdAt: user!.createdAt.toISOString(), token: createToken(user!.id) });
});

router.get("/users/search", async (req, res): Promise<void> => {
  const params = SearchUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { q, userId } = params.data;

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

  res.json({
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt.toISOString(),
    followerCount: Number(followerRow?.c ?? 0),
    followingCount: Number(followingRow?.c ?? 0),
    highlightCount: Number(highlightRow?.c ?? 0),
    commentCount: Number(commentRow?.c ?? 0),
    isFollowedByMe: isMe ? false : await isFollowing(req.userId, targetId),
    followsMe: isMe ? false : await isFollowing(targetId, req.userId),
    isMe,
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

export default router;
