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
  createLikeNotification,
  createMentionNotifications,
  getNotificationPrefs,
  sendReplyPush,
} from "../lib/notifications";
import {
  GetQuoteCommentsParams,
  GetQuoteCommentsQueryParams,
  GetCommentParams,
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
  const roomId = queryParams.success ? queryParams.data.roomId : undefined;

  const { quoteId } = params.data;
  const viewer = await getViewer(userId);
  // Room scope: only that room's comments, members only. Otherwise the
  // community visibility rules (which exclude other rooms' content).
  if (roomId != null && !viewer.roomIds.includes(roomId)) {
    res.status(403).json({ error: "Not a member of this room" });
    return;
  }
  const visible =
    roomId != null
      ? eq(commentsTable.roomId, roomId)
      : visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
          commentsTable.roomId,
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

  // Room-scoped comment: author must be a member of the room.
  const roomId = body.data.roomId ?? null;
  if (roomId != null) {
    const viewer = await getViewer(userId);
    if (!viewer.roomIds.includes(roomId)) {
      res.status(403).json({ error: "Not a member of this room" });
      return;
    }
  }

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
      containsSpoilers: body.data.containsSpoilers ?? false,
      roomId,
      authorProgress: body.data.authorProgress ?? null,
    })
    .returning();
  if (!comment) {
    res.status(500).json({ error: "Failed to create comment" });
    return;
  }

  // 'mention' notifications for @mentioned users (best-effort, non-fatal).
  try {
    await createMentionNotifications({
      text: body.data.text,
      actorId: userId,
      commentId: comment.id,
      containsSpoilers: body.data.containsSpoilers ?? false,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to create mention notifications");
  }

  const formatted = await formatComment(comment, userId);
  res.status(201).json(formatted);
});

// GET /comments/:commentId — single comment by id (visibility-gated).
// Used by the mobile app to open a reply thread from a notification.
router.get("/comments/:commentId", authenticate, async (req, res): Promise<void> => {
  const params = GetCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = req.userId;
  const viewer = await getViewer(userId);
  const [comment] = await db
    .select()
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, params.data.commentId),
        visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer, commentsTable.roomId, true),
      ),
    )
    .limit(1);
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const formatted = await formatComment(comment, userId);
  res.json(formatted);
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
        visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer, commentsTable.roomId, true),
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
        visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer, commentsTable.roomId, true),
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
        visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer, commentsTable.roomId, true),
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
      containsSpoilers: body.data.containsSpoilers ?? false,
      // Replies inherit the parent's room scope so threads never straddle scopes.
      roomId: parentComment.roomId ?? null,
      authorProgress: body.data.authorProgress ?? null,
    })
    .returning();
  if (!reply) {
    res.status(500).json({ error: "Failed to create reply" });
    return;
  }

  // Fire notifications (best-effort — don't fail the request if they error).
  try {
    const notifiedUserIds = new Set<number>();

    // 'reply' notification for the parent comment author — skipped entirely
    // (in-app AND push) when they disabled reply notifications.
    if (parentComment.userId !== userId) {
      const prefs = await getNotificationPrefs(parentComment.userId);
      if (prefs.notifyReplies) {
        await db.insert(notificationsTable).values({
          userId: parentComment.userId,
          type: "reply",
          actorId: userId,
          commentId: reply.id,
        });
        sendReplyPush({
          recipientId: parentComment.userId,
          actorId: userId,
          commentId: reply.id,
          text: body.data.text,
          containsSpoilers: body.data.containsSpoilers ?? false,
        });
      }
      // Even when reply notifications are off, don't double-notify the parent
      // author via a mention in the same reply.
      notifiedUserIds.add(parentComment.userId);
    }

    // 'mention' notifications for @mentioned users.
    await createMentionNotifications({
      text: body.data.text,
      actorId: userId,
      commentId: reply.id,
      excludeUserIds: notifiedUserIds,
      containsSpoilers: body.data.containsSpoilers ?? false,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to create reply/mention notifications");
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
    .select({
      id: commentsTable.id,
      userId: commentsTable.userId,
      text: commentsTable.text,
    })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, commentId),
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

    // Notify the comment author (best-effort, non-fatal; skips self-likes and
    // disabled settings inside the helper).
    try {
      await createLikeNotification({
        recipientId: visibleComment.userId,
        actorId: userId,
        type: "comment_like",
        commentId,
        previewText: visibleComment.text,
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to create comment like notification");
    }

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
          commentsTable.roomId,
          true,
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
