import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  notificationsTable,
  usersTable,
  commentsTable,
  quotesTable,
  userHighlightsTable,
} from "@workspace/db";
import {
  GetNotificationsParams,
  MarkNotificationsReadParams,
  MarkNotificationReadParams,
} from "@workspace/api-zod";
import type { NotificationItem } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

router.get("/users/:userId/notifications", authenticate, async (req, res): Promise<void> => {
  const params = GetNotificationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const notifs = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const unreadCount = notifs.filter((n) => !n.read).length;

  if (notifs.length === 0) {
    res.json({ notifications: [], unreadCount: 0 });
    return;
  }

  const actorIds = [...new Set(notifs.map((n) => n.actorId))];
  // friend_* notifications have no comment; highlight_like has a highlight instead.
  const commentIds = [
    ...new Set(
      notifs
        .map((n) => n.commentId)
        .filter((id): id is number => id != null),
    ),
  ];
  const highlightIds = [
    ...new Set(
      notifs
        .map((n) => n.highlightId)
        .filter((id): id is number => id != null),
    ),
  ];

  const [actors, comments, highlights] = await Promise.all([
    db.select().from(usersTable).where(inArray(usersTable.id, actorIds)),
    commentIds.length
      ? db.select().from(commentsTable).where(inArray(commentsTable.id, commentIds))
      : Promise.resolve([]),
    highlightIds.length
      ? db
          .select()
          .from(userHighlightsTable)
          .where(inArray(userHighlightsTable.id, highlightIds))
      : Promise.resolve([]),
  ]);

  const actorMap = new Map(actors.map((a) => [a.id, a]));
  const commentMap = new Map(comments.map((c) => [c.id, c]));
  const highlightMap = new Map(highlights.map((h) => [h.id, h]));

  const quoteIds = [
    ...new Set([
      ...comments.map((c) => c.quoteId),
      ...highlights.map((h) => h.quoteId),
    ]),
  ];
  const quotes = quoteIds.length
    ? await db.select().from(quotesTable).where(inArray(quotesTable.id, quoteIds))
    : [];
  const quoteMap = new Map(quotes.map((q) => [q.id, q]));

  const items: NotificationItem[] = notifs.map((n) => {
    const actor = actorMap.get(n.actorId);
    const comment = n.commentId != null ? commentMap.get(n.commentId) : undefined;
    const highlight =
      n.highlightId != null ? highlightMap.get(n.highlightId) : undefined;
    // highlight_like anchors to the highlight's quote; everything else to the comment's.
    const quoteId = comment?.quoteId ?? highlight?.quoteId;
    const quote = quoteId != null ? quoteMap.get(quoteId) : undefined;
    return {
      id: n.id,
      type: n.type,
      actorId: n.actorId,
      actorUsername: actor?.username ?? "unknown",
      actorAvatarColor: actor?.avatarColor ?? "#7A8BAA",
      commentId: n.commentId ?? 0,
      commentText: comment?.text ?? "",
      parentCommentId: comment?.parentId ?? null,
      quoteId: quoteId ?? 0,
      quoteText: quote?.text ?? "",
      read: n.read,
      createdAt: n.createdAt,
    };
  });

  res.json({ notifications: items, unreadCount });
});

router.put("/users/:userId/notifications/read-all", authenticate, async (req, res): Promise<void> => {
  const params = MarkNotificationsReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(
      and(
        eq(notificationsTable.userId, req.userId),
        eq(notificationsTable.read, false),
      ),
    );

  res.json({ unreadCount: 0 });
});

// PUT /notifications/:notificationId/read — mark a single notification as read.
// Only the owner may mark it; others get 404 (no existence leak).
router.put("/notifications/:notificationId/read", authenticate, async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [updated] = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(
      and(
        eq(notificationsTable.id, params.data.notificationId),
        eq(notificationsTable.userId, req.userId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const remaining = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, req.userId),
        eq(notificationsTable.read, false),
      ),
    );

  res.json({ unreadCount: remaining.length });
});

export default router;
