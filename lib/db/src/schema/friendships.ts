import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Directional follow graph. One row = `userId` follows `friendId`.
// following(me) = rows where userId = me; followers(me) = rows where friendId = me;
// friends = mutual (both directions exist).
export const friendshipsTable = pgTable(
  "friendships",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    friendId: integer("friend_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("friendships_user_friend_unique").on(t.userId, t.friendId),
  ],
);

export type Friendship = typeof friendshipsTable.$inferSelect;
export type InsertFriendship = typeof friendshipsTable.$inferInsert;
