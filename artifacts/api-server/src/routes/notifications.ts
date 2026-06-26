import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  notificationsTable,
  usersTable,
  commentsTable,
  quotesTable,
} from "@workspace/db";
import {
  GetNotificationsParams,
  MarkNotificationsReadParams,
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
  const commentIds = [...new Set(notifs.map((n) => n.commentId))];

  const [actors, comments] = await Promise.all([
    db.select().from(usersTable).where(inArray(usersTable.id, actorIds)),
    db.select().from(commentsTable).where(inArray(commentsTable.id, commentIds)),
  ]);

  const actorMap = new Map(actors.map((a) => [a.id, a]));
  const commentMap = new Map(comments.map((c) => [c.id, c]));

  const quoteIds = [...new Set(comments.map((c) => c.quoteId))];
  const quotes = quoteIds.length
    ? await db.select().from(quotesTable).where(inArray(quotesTable.id, quoteIds))
    : [];
  const quoteMap = new Map(quotes.map((q) => [q.id, q]));

  const items: NotificationItem[] = notifs.map((n) => {
    const actor = actorMap.get(n.actorId);
    const comment = commentMap.get(n.commentId);
    const quote = comment ? quoteMap.get(comment.quoteId) : undefined;
    return {
      id: n.id,
      type: n.type,
      actorId: n.actorId,
      actorUsername: actor?.username ?? "unknown",
      actorAvatarColor: actor?.avatarColor ?? "#7A8BAA",
      commentId: n.commentId,
      commentText: comment?.text ?? "",
      parentCommentId: comment?.parentId ?? null,
      quoteId: comment?.quoteId ?? 0,
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

export default router;
