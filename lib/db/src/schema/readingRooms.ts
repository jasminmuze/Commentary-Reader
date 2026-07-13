import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

// A reading room: a book club anchored to exactly one canonical book.
// Public rooms are discoverable and joinable by anyone; private rooms are
// invite-only and never surface in search/browse.
export const readingRoomsTable = pgTable("reading_rooms", {
  id: serial("id").primaryKey(),
  canonicalBookId: integer("canonical_book_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isPublic: boolean("is_public").notNull().default(true),
  // The room creator (host). Also present in room_members with role "owner".
  ownerId: integer("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReadingRoom = typeof readingRoomsTable.$inferSelect;
export type InsertReadingRoom = typeof readingRoomsTable.$inferInsert;
