import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const commentSavesTable = pgTable("comment_saves", {
  id: serial("id").primaryKey(),
  commentId: integer("comment_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommentSave = typeof commentSavesTable.$inferSelect;
export type InsertCommentSave = typeof commentSavesTable.$inferInsert;
