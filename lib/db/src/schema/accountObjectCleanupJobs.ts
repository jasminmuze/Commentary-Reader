import {
  pgTable,
  serial,
  integer,
  jsonb,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const accountObjectCleanupJobsTable = pgTable("account_object_cleanup_jobs", {
  id: serial("id").primaryKey(),
  objectPaths: jsonb("object_paths").notNull().$type<string[]>(),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccountObjectCleanupJob = typeof accountObjectCleanupJobsTable.$inferSelect;
export type InsertAccountObjectCleanupJob = typeof accountObjectCleanupJobsTable.$inferInsert;