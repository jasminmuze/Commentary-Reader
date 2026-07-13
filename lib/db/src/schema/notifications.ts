import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export type NotificationType =
  | "reply"
  | "mention"
  | "friend_request"
  | "friend_accept"
  | "highlight_like"
  | "comment_like"
  | "room_invite";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  // Recipient of the notification.
  userId: integer("user_id").notNull(),
  // "reply": someone replied to your comment. "mention": you were @mentioned.
  // "friend_request": someone sent you a friend request. "friend_accept": your request was accepted.
  type: text("type").notNull().$type<NotificationType>(),
  // Actor who triggered the notification.
  actorId: integer("actor_id").notNull(),
  // The comment or reply that triggered the notification (null for friend_* and
  // highlight_like types). For comment_like this is the liked comment.
  commentId: integer("comment_id"),
  // The liked highlight (only set for highlight_like notifications).
  highlightId: integer("highlight_id"),
  // The reading room (only set for room_invite notifications).
  roomId: integer("room_id"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
