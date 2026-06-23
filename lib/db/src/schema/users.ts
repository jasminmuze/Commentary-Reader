import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export type Visibility = "public" | "friends" | "private";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  avatarColor: text("avatar_color").notNull(),
  // Default visibility applied to new comments/highlights unless overridden.
  defaultVisibility: text("default_visibility")
    .notNull()
    .default("public")
    .$type<Visibility>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
