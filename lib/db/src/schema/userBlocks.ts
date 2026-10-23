import {
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userBlocksTable = pgTable(
  "user_blocks",
  {
    id: serial("id").primaryKey(),
    blockerId: integer("blocker_id").notNull(),
    blockedId: integer("blocked_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_blocks_blocker_blocked_unique").on(
      t.blockerId,
      t.blockedId,
    ),
  ],
);

export type UserBlock = typeof userBlocksTable.$inferSelect;
export type InsertUserBlock = typeof userBlocksTable.$inferInsert;
