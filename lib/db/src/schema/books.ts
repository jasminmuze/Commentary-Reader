import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const booksTable = pgTable("books", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  description: text("description").notNull(),
  coverColor: text("cover_color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Book = typeof booksTable.$inferSelect;
export type InsertBook = typeof booksTable.$inferInsert;
