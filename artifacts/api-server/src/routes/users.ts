import { Router, type IRouter } from "express";
import { eq, and, like, ne } from "drizzle-orm";
import {
  db,
  usersTable,
  friendshipsTable,
  commentsTable,
  commentSavesTable,
  commentLikesTable,
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
} from "@workspace/api-zod";

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
    res.json({ id: user.id, username: user.username, avatarColor: user.avatarColor, createdAt: user.createdAt.toISOString() });
    return;
  }

  const [user] = await db.insert(usersTable).values({
    username: body.data.username,
    avatarColor: randomAvatarColor(),
  }).returning();

  res.json({ id: user!.id, username: user!.username, avatarColor: user!.avatarColor, createdAt: user!.createdAt.toISOString() });
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

router.get("/users/:userId", async (req, res): Promise<void> => {
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

  res.json({ id: user.id, username: user.username, avatarColor: user.avatarColor, createdAt: user.createdAt.toISOString() });
});

router.get("/users/:userId/friends", async (req, res): Promise<void> => {
  const params = GetFriendsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
  res.json(filtered.map((u) => ({ id: u.id, username: u.username, avatarColor: u.avatarColor, createdAt: u.createdAt.toISOString() })));
});

router.post("/users/:userId/friends", async (req, res): Promise<void> => {
  const params = AddFriendParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = AddFriendBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { userId } = params.data;
  const { friendId } = body.data;

  const existing = await db.select().from(friendshipsTable).where(and(eq(friendshipsTable.userId, userId), eq(friendshipsTable.friendId, friendId)));
  if (existing.length === 0) {
    await db.insert(friendshipsTable).values({ userId, friendId });
    await db.insert(friendshipsTable).values({ userId: friendId, friendId: userId }).onConflictDoNothing();
  }

  const [friend] = await db.select().from(usersTable).where(eq(usersTable.id, friendId));
  if (!friend) {
    res.status(404).json({ error: "Friend not found" });
    return;
  }

  res.json({ id: friend.id, username: friend.username, avatarColor: friend.avatarColor, createdAt: friend.createdAt.toISOString() });
});

router.delete("/users/:userId/friends/:friendId", async (req, res): Promise<void> => {
  const params = RemoveFriendParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { userId, friendId } = params.data;
  await db.delete(friendshipsTable).where(and(eq(friendshipsTable.userId, userId), eq(friendshipsTable.friendId, friendId)));
  await db.delete(friendshipsTable).where(and(eq(friendshipsTable.userId, friendId), eq(friendshipsTable.friendId, userId)));
  res.sendStatus(204);
});

router.get("/users/:userId/saved-comments", async (req, res): Promise<void> => {
  const params = GetSavedCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { userId } = params.data;
  const saves = await db.select({ commentId: commentSavesTable.commentId }).from(commentSavesTable).where(eq(commentSavesTable.userId, userId));

  if (saves.length === 0) {
    res.json([]);
    return;
  }

  const commentIds = saves.map((s) => s.commentId);
  const comments = await db.select().from(commentsTable);
  const filtered = comments.filter((c) => commentIds.includes(c.id));

  const result = await Promise.all(filtered.map(async (c) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, c.userId));
    const likedByMe = (await db.select().from(commentLikesTable).where(and(eq(commentLikesTable.commentId, c.id), eq(commentLikesTable.userId, userId)))).length > 0;
    return {
      id: c.id,
      passageId: c.passageId,
      userId: c.userId,
      username: user?.username ?? "unknown",
      avatarColor: user?.avatarColor ?? "#7A8BAA",
      text: c.text,
      likeCount: c.likeCount,
      likedByMe,
      savedByMe: true,
      createdAt: c.createdAt.toISOString(),
    };
  }));

  res.json(result);
});

export default router;
