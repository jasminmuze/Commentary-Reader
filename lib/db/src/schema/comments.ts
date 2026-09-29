import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import type { ContentVisibility } from "./users";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  // Comments are anchored to a canonical quote (cross-edition), not a file position.
  quoteId: integer("quote_id").notNull(),
  userId: integer("user_id").notNull(),
  text: text("text").notNull(),
  // Who can see this comment: public | friends (mutual follows) | private
  // (author only) | room (members of `roomId` only — requires roomId).
  visibility: text("visibility")
    .notNull()
    .default("public")
    .$type<ContentVisibility>(),
  likeCount: integer("like_count").notNull().default(0),
  // Author-flagged spoiler: other users see the text blurred until they tap to reveal.
  containsSpoilers: boolean("contains_spoilers").notNull().default(false),
  // NULL = top-level comment. Non-null = reply to a top-level comment (max 1 level deep).
  parentId: integer("parent_id"),
  // NULL = whole-community comment (governed by `visibility`). Non-null =
  // room-scoped: visible ONLY to members of that reading room.
  roomId: integer("room_id"),
  // Author's reading progress (0-100) at the time of writing — an approximation
  // used by the room spoiler guard (blur when authorProgress > viewer progress).
  authorProgress: integer("author_progress"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Comment = typeof commentsTable.$inferSelect;
export type InsertComment = typeof commentsTable.$inferInsert;
