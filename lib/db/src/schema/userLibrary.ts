import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

// A user's personal uploaded EPUB file plus its (optional) match to a canonical book.
export const userLibraryTable = pgTable("user_library", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Null until matched to a canonical book (auto-match or manual).
  canonicalBookId: integer("canonical_book_id"),
  // Object-storage path of the uploaded EPUB, e.g. "/objects/uploads/<uuid>".
  epubObjectPath: text("epub_object_path").notNull(),
  // Raw metadata parsed from the EPUB at upload time (for display + manual matching).
  originalTitle: text("original_title"),
  originalAuthor: text("original_author"),
  originalIsbn: text("original_isbn"),
  // Last reading position (EPUB CFI) for the owning user, saved as they read.
  lastReadingLocation: text("last_reading_location"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserLibraryEntry = typeof userLibraryTable.$inferSelect;
export type InsertUserLibraryEntry = typeof userLibraryTable.$inferInsert;
