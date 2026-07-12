import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// A user's like on another user's highlight. One row per (highlight, user);
// like counts are computed by GROUP BY on this table (no denormalized counter
// on user_highlights, matching the no-denorm convention for highlights).
export const highlightLikesTable = pgTable(
  "highlight_likes",
  {
    id: serial("id").primaryKey(),
    highlightId: integer("highlight_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("highlight_likes_highlight_user_unique").on(
      t.highlightId,
      t.userId,
    ),
  ],
);

export type HighlightLike = typeof highlightLikesTable.$inferSelect;
export type InsertHighlightLike = typeof highlightLikesTable.$inferInsert;
