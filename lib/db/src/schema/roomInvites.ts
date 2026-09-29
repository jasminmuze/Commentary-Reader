import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Pending room invites only (same pattern as friend_requests): a row means
// `inviterId` (a room member) invited `inviteeId` to `roomId` and the invitee
// has not answered yet. Accept/decline both DELETE the row (accept also
// creates the membership), so a declined invitee can simply be invited again.
export const roomInvitesTable = pgTable(
  "room_invites",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id").notNull(),
    inviterId: integer("inviter_id").notNull(),
    inviteeId: integer("invitee_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("room_invites_room_invitee_unique").on(t.roomId, t.inviteeId),
  ],
);

export type RoomInvite = typeof roomInvitesTable.$inferSelect;
export type InsertRoomInvite = typeof roomInvitesTable.$inferInsert;
