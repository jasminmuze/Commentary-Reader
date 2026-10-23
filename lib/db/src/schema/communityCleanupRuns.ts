import { jsonb, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Durable one-time guard for the prelaunch community cleanup. The fixed
 * primary key prevents a second apply, including across server instances.
 */
export const communityCleanupRunsTable = pgTable("community_cleanup_runs", {
  scopeKey: text("scope_key").primaryKey(),
  requestedByUserId: integer("requested_by_user_id").notNull(),
  previewHash: text("preview_hash").notNull(),
  affectedCounts: jsonb("affected_counts")
    .notNull()
    .$type<Record<string, number>>(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
