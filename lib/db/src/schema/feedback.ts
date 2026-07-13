import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

// In-app user feedback / bug reports, submitted from the profile screen.
// Write-only for now (no admin view yet) — rows are just stored for review.
export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // "feedback" (general suggestion) or "bug" (problem report).
  type: text("type").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Feedback = typeof feedbackTable.$inferSelect;
export type InsertFeedback = typeof feedbackTable.$inferInsert;
