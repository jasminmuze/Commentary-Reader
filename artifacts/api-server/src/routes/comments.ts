import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import {
  db,
  commentsTable,
  commentLikesTable,
  commentSavesTable,
  quotesTable,
  usersTable,
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
import {
  getFollowingIds,
  getViewer,
  visibilityPredicate,
} from "../lib/social";
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
  const viewer = await getViewer(userId);
  const visible = visibilityPredicate(
    commentsTable.visibility,
    commentsTable.userId,
    viewer,
  );
  let comments;

  if (filter === "friends") {
    // "Friends" tab = comments by people I follow, still gated by visibility
    // (a followed user's friends-only post shows only if we're mutual).
    const followingIds = await getFollowingIds(userId);
    if (followingIds.length === 0) {
      res.json([]);
      return;
    }
    comments = await db
      .select()
      .from(commentsTable)
      .where(
        and(
          eq(commentsTable.quoteId, quoteId),
          inArray(commentsTable.userId, followingIds),
          visible,
        ),
      )
      .orderBy(desc(commentsTable.likeCount));
  } else if (filter === "best") {
    comments = await db
      .select()
      .from(commentsTable)
      .where(and(eq(commentsTable.quoteId, quoteId), visible))
      .orderBy(desc(commentsTable.likeCount))
      .limit(10);
  } else {
    comments = await db
      .select()
      .from(commentsTable)
      .where(and(eq(commentsTable.quoteId, quoteId), visible))
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
  let visibility = body.data.visibility;
  if (!visibility) {
    const [author] = await db
      .select({ defaultVisibility: usersTable.defaultVisibility })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    visibility = author?.defaultVisibility ?? "public";
  }

  const [comment] = await db
    .insert(commentsTable)
    .values({
      quoteId: params.data.quoteId,
      userId,
      text: body.data.text,
      visibility,
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

  // Authz: you may only like a comment you are allowed to see.
  const viewer = await getViewer(userId);
  const [visibleComment] = await db
    .select({ id: commentsTable.id })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, commentId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    )
    .limit(1);
  if (!visibleComment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

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

  // Authz: you may only save a comment you are allowed to see.
  const viewer = await getViewer(userId);
  const [visibleComment] = await db
    .select({ id: commentsTable.id })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, commentId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    )
    .limit(1);
  if (!visibleComment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

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
