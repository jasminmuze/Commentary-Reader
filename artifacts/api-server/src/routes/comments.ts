import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import {
  db,
  commentsTable,
  commentLikesTable,
  commentSavesTable,
  usersTable,
  friendshipsTable,
  passagesTable,
} from "@workspace/db";
import {
  GetPassageCommentsParams,
  GetPassageCommentsQueryParams,
  CreateCommentBody,
  LikeCommentParams,
  LikeCommentBody,
  SaveCommentParams,
  SaveCommentBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function formatComment(comment: { id: number; passageId: number; userId: number; text: string; likeCount: number; createdAt: Date }, userId?: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, comment.userId));
  const likedByMe = userId
    ? (await db.select().from(commentLikesTable).where(and(eq(commentLikesTable.commentId, comment.id), eq(commentLikesTable.userId, userId)))).length > 0
    : false;
  const savedByMe = userId
    ? (await db.select().from(commentSavesTable).where(and(eq(commentSavesTable.commentId, comment.id), eq(commentSavesTable.userId, userId)))).length > 0
    : false;

  return {
    id: comment.id,
    passageId: comment.passageId,
    userId: comment.userId,
    username: user?.username ?? "unknown",
    avatarColor: user?.avatarColor ?? "#7A8BAA",
    text: comment.text,
    likeCount: comment.likeCount,
    likedByMe,
    savedByMe,
    createdAt: comment.createdAt.toISOString(),
  };
}

router.get("/passages/:passageId/comments", async (req, res): Promise<void> => {
  const params = GetPassageCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const queryParams = GetPassageCommentsQueryParams.safeParse(req.query);
  const userId = queryParams.success ? queryParams.data.userId : undefined;
  const filter = queryParams.success ? (queryParams.data.filter ?? "all") : "all";

  let comments;

  if (filter === "friends" && userId) {
    const friendships = await db.select({ friendId: friendshipsTable.friendId }).from(friendshipsTable).where(eq(friendshipsTable.userId, userId));
    const friendIds = friendships.map((f) => f.friendId);
    if (friendIds.length === 0) {
      res.json([]);
      return;
    }
    comments = await db
      .select()
      .from(commentsTable)
      .where(and(eq(commentsTable.passageId, params.data.passageId), inArray(commentsTable.userId, friendIds)))
      .orderBy(desc(commentsTable.likeCount));
  } else if (filter === "best") {
    comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.passageId, params.data.passageId))
      .orderBy(desc(commentsTable.likeCount))
      .limit(10);
  } else {
    comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.passageId, params.data.passageId))
      .orderBy(desc(commentsTable.likeCount));
  }

  const formatted = await Promise.all(comments.map((c) => formatComment(c, userId)));
  res.json(formatted);
});

router.post("/passages/:passageId/comments", async (req, res): Promise<void> => {
  const params = GetPassageCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CreateCommentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [passage] = await db.select().from(passagesTable).where(eq(passagesTable.id, params.data.passageId));
  if (!passage) {
    res.status(404).json({ error: "Passage not found" });
    return;
  }

  const [comment] = await db.insert(commentsTable).values({
    passageId: params.data.passageId,
    userId: body.data.userId,
    text: body.data.text,
    likeCount: 0,
  }).returning();

  const formatted = await formatComment(comment!, body.data.userId);
  res.status(201).json(formatted);
});

router.post("/comments/:commentId/like", async (req, res): Promise<void> => {
  const params = LikeCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = LikeCommentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { commentId } = params.data;
  const { userId } = body.data;

  const existing = await db.select().from(commentLikesTable).where(and(eq(commentLikesTable.commentId, commentId), eq(commentLikesTable.userId, userId)));

  if (existing.length > 0) {
    await db.delete(commentLikesTable).where(and(eq(commentLikesTable.commentId, commentId), eq(commentLikesTable.userId, userId)));
    const [updated] = await db.update(commentsTable).set({ likeCount: sql`${commentsTable.likeCount} - 1` }).where(eq(commentsTable.id, commentId)).returning();
    res.json({ liked: false, likeCount: updated?.likeCount ?? 0 });
  } else {
    await db.insert(commentLikesTable).values({ commentId, userId });
    const [updated] = await db.update(commentsTable).set({ likeCount: sql`${commentsTable.likeCount} + 1` }).where(eq(commentsTable.id, commentId)).returning();
    res.json({ liked: true, likeCount: updated?.likeCount ?? 0 });
  }
});

router.post("/comments/:commentId/save", async (req, res): Promise<void> => {
  const params = SaveCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SaveCommentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { commentId } = params.data;
  const { userId } = body.data;

  const existing = await db.select().from(commentSavesTable).where(and(eq(commentSavesTable.commentId, commentId), eq(commentSavesTable.userId, userId)));

  if (existing.length > 0) {
    await db.delete(commentSavesTable).where(and(eq(commentSavesTable.commentId, commentId), eq(commentSavesTable.userId, userId)));
    res.json({ saved: false });
  } else {
    await db.insert(commentSavesTable).values({ commentId, userId });
    res.json({ saved: true });
  }
});

export default router;
