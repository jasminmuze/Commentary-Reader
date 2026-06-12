import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// A canonical quote belonging to a canonical book. Identity is the normalized
// text hash, so the same passage highlighted/commented from different EPUB files
// (editions) of the same book collapses to one quote.
export const quotesTable = pgTable(
  "quotes",
  {
    id: serial("id").primaryKey(),
    canonicalBookId: integer("canonical_book_id").notNull(),
    // Display text (raw selection as first stored). Used for showing + searching.
    text: text("text").notNull(),
    // Normalized form of `text` (see lib/text.ts normalizeText).
    normText: text("norm_text").notNull(),
    // sha256(normText). The btree unique index uses the hash, not the raw text,
    // because long quotes can exceed the ~2700B btree index row limit.
    normTextHash: text("norm_text_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("quotes_book_hash_unique").on(t.canonicalBookId, t.normTextHash),
  ],
);

export type Quote = typeof quotesTable.$inferSelect;
export type InsertQuote = typeof quotesTable.$inferInsert;
