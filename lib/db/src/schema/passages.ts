import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const passagesTable = pgTable("passages", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id").notNull(),
  orderIndex: integer("order_index").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Passage = typeof passagesTable.$inferSelect;
export type InsertPassage = typeof passagesTable.$inferInsert;
