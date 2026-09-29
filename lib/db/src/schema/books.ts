import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const booksTable = pgTable("books", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  // Normalized title/author used for auto-matching uploaded EPUBs to a canonical book.
  normTitle: text("norm_title").notNull(),
  normAuthor: text("norm_author").notNull(),
  // Optional ISBN parsed from EPUB metadata (dc:identifier). Not always present/valid.
  isbn: text("isbn"),
  description: text("description").notNull().default(""),
  coverColor: text("cover_color").notNull(),
  // Public object path (/public-objects/covers/<id>) of the cover image
  // extracted from the first uploaded EPUB that contained one. Null = color cover.
  coverUrl: text("cover_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Book = typeof booksTable.$inferSelect;
export type InsertBook = typeof booksTable.$inferInsert;
