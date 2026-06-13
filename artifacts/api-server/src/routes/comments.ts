import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import {
  db,
  commentsTable,
  commentLikesTable,
  commentSavesTable,
  quotesTable,
  friendshipsTable,
} from "@workspace/db";
import {
  GetQuoteCommentsParams,
  GetQuoteCommentsQueryParams,
  CreateCommentParams,
  CreateCommentBody,
  LikeCommentParams,
  SaveCommentParams,
} from "@workspace/api-zod";
import { formatComment } from "../lib/queries";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

router.get("/quotes/:quoteId/comments", authenticate, async (req, res): Promise<void> => {
  const params = GetQuoteCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const queryParams = GetQuoteCommentsQueryParams.safeParse(req.query);
  const userId = req.userId;
  const filter = queryParams.success
    ? (queryParams.data.filter ?? "all")
    : "all";

  const { quoteId } = params.data;
  let comments;

  if (filter === "friends") {
    const friendships = await db
      .select({ friendId: friendshipsTable.friendId })
      .from(friendshipsTable)
      .where(eq(friendshipsTable.userId, userId));
    const friendIds = friendships.map((f) => f.friendId);
    if (friendIds.length === 0) {
      res.json([]);
      return;
    }
    comments = await db
      .select()
      .from(commentsTable)
      .where(
        and(
          eq(commentsTable.quoteId, quoteId),
          inArray(commentsTable.userId, friendIds),
        ),
      )
      .orderBy(desc(commentsTable.likeCount));
  } else if (filter === "best") {
    comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.quoteId, quoteId))
      .orderBy(desc(commentsTable.likeCount))
      .limit(10);
  } else {
    comments = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.quoteId, quoteId))
      .orderBy(desc(commentsTable.likeCount));
  }

  const formatted = await Promise.all(
    comments.map((c) => formatComment(c, userId)),
  );
  res.json(formatted);
});

router.post("/quotes/:quoteId/comments", authenticate, async (req, res): Promise<void> => {
  const params = CreateCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CreateCommentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.id, params.data.quoteId));
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }

  const userId = req.userId;
  const [comment] = await db
    .insert(commentsTable)
    .values({
      quoteId: params.data.quoteId,
      userId,
      text: body.data.text,
      likeCount: 0,
    })
    .returning();

  const formatted = await formatComment(comment!, userId);
  res.status(201).json(formatted);
});

router.post("/comments/:commentId/like", authenticate, async (req, res): Promise<void> => {
  const params = LikeCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { commentId } = params.data;
  const userId = req.userId;

  const existing = await db
    .select()
    .from(commentLikesTable)
    .where(
      and(
        eq(commentLikesTable.commentId, commentId),
        eq(commentLikesTable.userId, userId),
      ),
    );

  if (existing.length > 0) {
    await db
      .delete(commentLikesTable)
      .where(
        and(
          eq(commentLikesTable.commentId, commentId),
          eq(commentLikesTable.userId, userId),
        ),
      );
    const [updated] = await db
      .update(commentsTable)
      .set({ likeCount: sql`${commentsTable.likeCount} - 1` })
      .where(eq(commentsTable.id, commentId))
      .returning();
    res.json({ liked: false, likeCount: updated?.likeCount ?? 0 });
  } else {
    await db.insert(commentLikesTable).values({ commentId, userId });
    const [updated] = await db
      .update(commentsTable)
      .set({ likeCount: sql`${commentsTable.likeCount} + 1` })
      .where(eq(commentsTable.id, commentId))
      .returning();
    res.json({ liked: true, likeCount: updated?.likeCount ?? 0 });
  }
});

router.post("/comments/:commentId/save", authenticate, async (req, res): Promise<void> => {
  const params = SaveCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { commentId } = params.data;
  const userId = req.userId;

  const existing = await db
    .select()
    .from(commentSavesTable)
    .where(
      and(
        eq(commentSavesTable.commentId, commentId),
        eq(commentSavesTable.userId, userId),
      ),
    );

  if (existing.length > 0) {
    await db
      .delete(commentSavesTable)
      .where(
        and(
          eq(commentSavesTable.commentId, commentId),
          eq(commentSavesTable.userId, userId),
        ),
      );
    res.json({ saved: false });
  } else {
    await db.insert(commentSavesTable).values({ commentId, userId });
    res.json({ saved: true });
  }
});

export default router;
