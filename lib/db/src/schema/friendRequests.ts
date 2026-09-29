import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Pending friend requests. A row means `requesterId` asked `recipientId` to be
// friends and the recipient has not answered yet. Accept/decline both DELETE
// the row (accept additionally creates mutual follow rows in `friendships`),
// so a declined requester can simply request again later.
export const friendRequestsTable = pgTable(
  "friend_requests",
  {
    id: serial("id").primaryKey(),
    requesterId: integer("requester_id").notNull(),
    recipientId: integer("recipient_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("friend_requests_requester_recipient_unique").on(
      t.requesterId,
      t.recipientId,
    ),
  ],
);

export type FriendRequest = typeof friendRequestsTable.$inferSelect;
export type InsertFriendRequest = typeof friendRequestsTable.$inferInsert;
