import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export type NotificationType = "reply" | "mention";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  // Recipient of the notification.
  userId: integer("user_id").notNull(),
  // "reply": someone replied to your comment. "mention": you were @mentioned in a reply.
  type: text("type").notNull().$type<NotificationType>(),
  // Actor who triggered the notification (the reply author).
  actorId: integer("actor_id").notNull(),
  // The reply comment that triggered the notification.
  commentId: integer("comment_id").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
