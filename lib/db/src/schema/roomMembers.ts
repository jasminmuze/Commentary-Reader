import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type RoomRole = "owner" | "member";

// Room membership. One row per (room, user); the room creator gets role
// "owner", everyone else "member". Leaving/kicking deletes the row.
export const roomMembersTable = pgTable(
  "room_members",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id").notNull(),
    userId: integer("user_id").notNull(),
    role: text("role").notNull().default("member").$type<RoomRole>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("room_members_room_user_unique").on(t.roomId, t.userId)],
);

export type RoomMember = typeof roomMembersTable.$inferSelect;
export type InsertRoomMember = typeof roomMembersTable.$inferInsert;
