import { commentsTable, quotesTable, readingRoomsTable, roomMembersTable } from "@workspace/db";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

/**
 * Ordinary Public/Friends comments participate in the author's book rooms.
 * Explicit room posts never spread to a different room; Private stays private.
 * Resolve membership at read time, so leaving a room revokes implicit sharing.
 */
export function roomCommentScope(roomIds: number[]): SQL {
  if (roomIds.length === 0) return sql`false`;
  return or(
    and(
      inArray(commentsTable.roomId, roomIds),
      sql`${commentsTable.visibility} <> 'private'`,
    ),
    and(
      isNull(commentsTable.roomId),
      inArray(commentsTable.visibility, ["public", "friends"]),
      sql`exists (
        select 1 from ${roomMembersTable}
        inner join ${readingRoomsTable}
          on ${readingRoomsTable.id} = ${roomMembersTable.roomId}
        inner join ${quotesTable}
          on ${quotesTable.canonicalBookId} = ${readingRoomsTable.canonicalBookId}
        where ${roomMembersTable.userId} = ${commentsTable.userId}
          and ${inArray(roomMembersTable.roomId, roomIds)}
          and ${quotesTable.id} = ${commentsTable.quoteId}
      )`,
    ),
  )!;
}
