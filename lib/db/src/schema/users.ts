import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export type Visibility = "public" | "friends" | "private";

// Content rows (comments/highlights) additionally support "room": visible only
// to members of the row's reading room. Never valid for users.defaultVisibility.
export type ContentVisibility = Visibility | "room";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // bcrypt hash; null for legacy/seeded demo accounts (cannot log in).
  passwordHash: text("password_hash"),
  // Signup email; null only for legacy/seeded accounts created before email
  // became required. Unique when present.
  email: text("email").unique(),
  // Optional display name shown instead of username; username stays the
  // immutable handle (mentions, login).
  nickname: text("nickname"),
  // Object path (e.g. /public-objects/avatars/<uuid>) for the profile photo;
  // null falls back to the colored initial avatar.
  avatarUrl: text("avatar_url"),
  // Set when the user confirms the 6-digit email verification code.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // sha256 hash of the pending verification code (never the raw code).
  emailVerificationCodeHash: text("email_verification_code_hash"),
  emailVerificationExpiresAt: timestamp("email_verification_expires_at", { withTimezone: true }),
  // Last send time — used to rate-limit resends.
  emailVerificationSentAt: timestamp("email_verification_sent_at", { withTimezone: true }),
  // Password reset — same pattern as email verification.
  // sha256 hash of the pending 6-digit reset code (never the raw code).
  passwordResetCodeHash: text("password_reset_code_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
  // Last reset-email send time — used to rate-limit resends.
  passwordResetSentAt: timestamp("password_reset_sent_at", { withTimezone: true }),
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
  notifyRooms: boolean("notify_rooms").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
