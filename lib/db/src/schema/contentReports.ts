import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const contentReportsTable = pgTable(
  "content_reports",
  {
    id: serial("id").primaryKey(),
    reporterId: integer("reporter_id").notNull(),
    targetType: text("target_type", {
      enum: ["comment", "highlight", "user"],
    }).notNull(),
    targetId: integer("target_id").notNull(),
    reason: text("reason", {
      enum: [
        "spam",
        "harassment",
        "hate_or_abusive_content",
        "sexual_content",
        "copyright",
        "other",
      ],
    }).notNull(),
    details: text("details"),
    status: text("status", {
      enum: ["open", "reviewing", "resolved", "dismissed"],
    })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("content_reports_reporter_target_unique").on(
      t.reporterId,
      t.targetType,
      t.targetId,
    ),
    index("content_reports_status_created_at_idx").on(t.status, t.createdAt),
  ],
);

export type ContentReport = typeof contentReportsTable.$inferSelect;
export type InsertContentReport = typeof contentReportsTable.$inferInsert;
