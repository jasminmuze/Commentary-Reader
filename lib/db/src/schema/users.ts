import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export type Visibility = "public" | "friends" | "private";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // bcrypt hash; null for legacy/seeded demo accounts (cannot log in).
  passwordHash: text("password_hash"),
  avatarColor: text("avatar_color").notNull(),
  // Default visibility applied to new comments/highlights unless overridden.
  defaultVisibility: text("default_visibility")
    .notNull()
    .default("public")
    .$type<Visibility>(),
  // Per-type notification preferences. A disabled type skips BOTH in-app
  // notification creation and push delivery.
  notifyLikes: boolean("notify_likes").notNull().default(true),
  notifyReplies: boolean("notify_replies").notNull().default(true),
  notifyMentions: boolean("notify_mentions").notNull().default(true),
  notifyFriends: boolean("notify_friends").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
