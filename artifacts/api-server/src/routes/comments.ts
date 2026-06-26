import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, isNull, asc, sql } from "drizzle-orm";
import {
  db,
  commentsTable,
  commentLikesTable,
  commentSavesTable,
  quotesTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import {
  GetQuoteCommentsParams,
  GetQuoteCommentsQueryParams,
  CreateCommentParams,
  CreateCommentBody,
  LikeCommentParams,
  SaveCommentParams,
  GetCommentRepliesParams,
  CreateReplyParams,
  CreateReplyBody,
} from "@workspace/api-zod";
import { formatComment } from "../lib/queries";
import {
  getFollowingIds,
  getViewer,
  visibilityPredicate,
} from "../lib/social";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

function parseMentionedUsernames(text: string): string[] {
  return [...text.matchAll(/\B@(\w+)/g)].map((m) => m[1]!);
}

// GET /quotes/:quoteId/comments — top-level comments only (parentId IS NULL).
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
  // Only return top-level comments — replies are fetched separately.
  const topLevel = isNull(commentsTable.parentId);
  let comments;

  if (filter === "friends") {
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
          topLevel,
        ),
      )
      .orderBy(desc(commentsTable.likeCount));
  } else if (filter === "best") {
    comments = await db
      .select()
      .from(commentsTable)
      .where(and(eq(commentsTable.quoteId, quoteId), visible, topLevel))
      .orderBy(desc(commentsTable.likeCount))
      .limit(10);
  } else {
    comments = await db
      .select()
      .from(commentsTable)
      .where(and(eq(commentsTable.quoteId, quoteId), visible, topLevel))
      .orderBy(desc(commentsTable.likeCount));
  }

  const formatted = await Promise.all(
    comments.map((c) => formatComment(c, userId)),
  );
  res.json(formatted);
});

// POST /quotes/:quoteId/comments — create a top-level comment (parentId stays NULL).
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

// GET /comments/:commentId/replies — flat chronological replies (visibility-gated).
router.get("/comments/:commentId/replies", authenticate, async (req, res): Promise<void> => {
  const params = GetCommentRepliesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { commentId } = params.data;
  const userId = req.userId;

  // Ensure the parent comment exists and is visible to the viewer.
  const viewer = await getViewer(userId);
  const [parentComment] = await db
    .select()
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, commentId),
        isNull(commentsTable.parentId),
        visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer),
      ),
    )
    .limit(1);
  if (!parentComment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const replies = await db
    .select()
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.parentId, commentId),
        visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer),
      ),
    )
    .orderBy(asc(commentsTable.createdAt));

  const formatted = await Promise.all(
    replies.map((r) => formatComment(r, userId)),
  );
  res.json(formatted);
});

// POST /comments/:commentId/replies — reply to a top-level comment (max 1 level).
// Parses @username mentions and fires in-app notifications.
router.post("/comments/:commentId/replies", authenticate, async (req, res): Promise<void> => {
  const params = CreateReplyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CreateReplyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { commentId } = params.data;
  const userId = req.userId;
  const viewer = await getViewer(userId);

  // Ensure parent exists, is top-level, and is visible to the replier.
  const [parentComment] = await db
    .select()
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, commentId),
        isNull(commentsTable.parentId),
        visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer),
      ),
    )
    .limit(1);
  if (!parentComment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  let visibility = body.data.visibility;
  if (!visibility) {
    const [author] = await db
      .select({ defaultVisibility: usersTable.defaultVisibility })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    visibility = author?.defaultVisibility ?? "public";
  }

  const [reply] = await db
    .insert(commentsTable)
    .values({
      quoteId: parentComment.quoteId,
      userId,
      text: body.data.text,
      visibility,
      likeCount: 0,
      parentId: commentId,
    })
    .returning();
  if (!reply) {
    res.status(500).json({ error: "Failed to create reply" });
    return;
  }

  // Fire notifications (best-effort — don't fail the request if they error).
  try {
    const notifiedUserIds = new Set<number>([userId]);

    // 'reply' notification for the parent comment author.
    if (parentComment.userId !== userId) {
      await db.insert(notificationsTable).values({
        userId: parentComment.userId,
        type: "reply",
        actorId: userId,
        commentId: reply.id,
      });
      notifiedUserIds.add(parentComment.userId);
    }

    // 'mention' notifications for @mentioned users.
    const mentionedNames = parseMentionedUsernames(body.data.text);
    if (mentionedNames.length > 0) {
      const mentionedUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.username, mentionedNames));
      const toNotify = mentionedUsers.filter((u) => !notifiedUserIds.has(u.id));
      if (toNotify.length > 0) {
        await db.insert(notificationsTable).values(
          toNotify.map((u) => ({
            userId: u.id,
            type: "mention" as const,
            actorId: userId,
            commentId: reply.id,
          })),
        );
      }
    }
  } catch {
    // Notification errors are non-fatal.
  }

  const formatted = await formatComment(reply, userId);
  res.status(201).json(formatted);
});

// POST /comments/:commentId/like
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

// POST /comments/:commentId/save
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
