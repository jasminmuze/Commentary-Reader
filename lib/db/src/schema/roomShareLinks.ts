import {
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// One stable, revocable bearer link per private room. The public token itself
// is derived from the row ID and the server HMAC secret, so it is not stored.
export const roomShareLinksTable = pgTable(
  "room_share_links",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id").notNull(),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("room_share_links_room_unique").on(t.roomId)],
);

export type RoomShareLink = typeof roomShareLinksTable.$inferSelect;
export type InsertRoomShareLink = typeof roomShareLinksTable.$inferInsert;
