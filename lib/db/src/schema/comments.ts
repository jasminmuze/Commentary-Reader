import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import type { Visibility } from "./users";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  // Comments are anchored to a canonical quote (cross-edition), not a file position.
  quoteId: integer("quote_id").notNull(),
  userId: integer("user_id").notNull(),
  text: text("text").notNull(),
  // Who can see this comment: public | friends (mutual follows) | private (author only).
  visibility: text("visibility")
    .notNull()
    .default("public")
    .$type<Visibility>(),
  likeCount: integer("like_count").notNull().default(0),
  // NULL = top-level comment. Non-null = reply to a top-level comment (max 1 level deep).
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Comment = typeof commentsTable.$inferSelect;
export type InsertComment = typeof commentsTable.$inferInsert;
