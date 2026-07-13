import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Visibility } from "./users";

// A user's personal highlight of a canonical quote. One row per (user, quote);
// community "most highlighted" counts are computed by GROUP BY on this table
// (no denormalized counter on quotes).
export const userHighlightsTable = pgTable(
  "user_highlights",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    quoteId: integer("quote_id").notNull(),
    // The user's own library entry (their EPUB file) this highlight was made in.
    userLibraryId: integer("user_library_id"),
    // CFI range within the user's own file, used to restore their highlight fast.
    cfiRange: text("cfi_range"),
    // NULL = whole-community highlight (governed by `visibility`). Non-null =
    // room-scoped: visible ONLY to members of that reading room.
    roomId: integer("room_id"),
    // Author's reading progress (0-100) at highlight time (room spoiler guard).
    authorProgress: integer("author_progress"),
    // Who can see this highlight: public | friends (mutual follows) | private.
    visibility: text("visibility")
      .notNull()
      .default("public")
      .$type<Visibility>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_highlights_user_quote_unique").on(t.userId, t.quoteId),
  ],
);

export type UserHighlight = typeof userHighlightsTable.$inferSelect;
export type InsertUserHighlight = typeof userHighlightsTable.$inferInsert;
