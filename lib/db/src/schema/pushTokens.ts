import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Expo push tokens, one row per device token. A token is unique across the
// table and is reassigned to the latest user who registers it (account
// switching on the same device must not leak pushes to the previous account).
export const pushTokensTable = pgTable(
  "push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    // Expo push token, e.g. "ExponentPushToken[xxxxxxxx]".
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("push_tokens_token_unique").on(table.token)],
);

export type PushToken = typeof pushTokensTable.$inferSelect;
export type InsertPushToken = typeof pushTokensTable.$inferInsert;
