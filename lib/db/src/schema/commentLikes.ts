import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const commentLikesTable = pgTable("comment_likes", {
  id: serial("id").primaryKey(),
  commentId: integer("comment_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommentLike = typeof commentLikesTable.$inferSelect;
export type InsertCommentLike = typeof commentLikesTable.$inferInsert;
