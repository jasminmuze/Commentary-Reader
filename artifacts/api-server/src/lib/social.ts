import {
  db,
  friendshipsTable,
  roomMembersTable,
  userBlocksTable,
} from "@workspace/db";
import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Follow graph helpers. `friendships` is DIRECTIONAL: one row (userId -> friendId)
 * means `userId` follows `friendId`.
 *  - following(me) = rows where userId = me
 *  - followers(me) = rows where friendId = me
 *  - friends(me)   = mutual (both directions exist)
 */

/** IDs of users `userId` follows. */
export async function getFollowingIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: friendshipsTable.friendId })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.userId, userId));
  return rows.map((r) => r.id);
}

/** IDs of users who follow `userId`. */
export async function getFollowerIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: friendshipsTable.userId })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.friendId, userId));
  return rows.map((r) => r.id);
}

/** IDs of mutual follows (friends) of `userId`. */
export async function getMutualFriendIds(userId: number): Promise<number[]> {
  const following = await getFollowingIds(userId);
  if (following.length === 0) return [];
  const followers = await getFollowerIds(userId);
  const followerSet = new Set(followers);
  return following.filter((id) => followerSet.has(id));
}

/** User IDs blocked by or blocking `userId`; blocks are enforced both ways. */
export async function getBlockedUserIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({
      blockerId: userBlocksTable.blockerId,
      blockedId: userBlocksTable.blockedId,
    })
    .from(userBlocksTable)
    .where(
      or(
        eq(userBlocksTable.blockerId, userId),
        eq(userBlocksTable.blockedId, userId),
      ),
    );

  return [
    ...new Set(
      rows.map((row) =>
        row.blockerId === userId ? row.blockedId : row.blockerId,
      ),
    ),
  ];
}

/** Whether either user has blocked the other. */
export async function isBlockedBetween(
  firstUserId: number,
  secondUserId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: userBlocksTable.id })
    .from(userBlocksTable)
    .where(
      or(
        and(
          eq(userBlocksTable.blockerId, firstUserId),
          eq(userBlocksTable.blockedId, secondUserId),
        ),
        and(
          eq(userBlocksTable.blockerId, secondUserId),
          eq(userBlocksTable.blockedId, firstUserId),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Whether `userId` follows `targetId`. */
export async function isFollowing(
  userId: number,
  targetId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.userId, userId),
        eq(friendshipsTable.friendId, targetId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface Viewer {
  userId: number;
  /** Mutual-follow (friend) user IDs of the viewer. */
  mutualIds: number[];
  /** Reading rooms the viewer is a member of (for room-scoped content). */
  roomIds: number[];
  /** User IDs hidden from each other because of a block in either direction. */
  blockedIds: number[];
}

/** Reading-room IDs `userId` is a member of. */
export async function getRoomIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: roomMembersTable.roomId })
    .from(roomMembersTable)
    .where(eq(roomMembersTable.userId, userId));
  return rows.map((r) => r.id);
}

/** Build a Viewer (with mutual-friend + room-membership sets) for visibility filtering. */
export async function getViewer(userId: number): Promise<Viewer> {
  const [mutualIds, roomIds, blockedIds] = await Promise.all([
    getMutualFriendIds(userId),
    getRoomIds(userId),
    getBlockedUserIds(userId),
  ]);
  return { userId, mutualIds, roomIds, blockedIds };
}

/**
 * SQL predicate restricting visibility-gated rows (comments / highlights) to
 * what `viewer` may see. Rows come in two scopes:
 *   - Community rows (roomId IS NULL) follow the visibility column:
 *     public, the viewer's own, or friends-only from a mutual friend.
 *   - Room rows (roomId NOT NULL) follow the visibility column too:
 *     - visibility = 'room': visible ONLY to members of that room (never in
 *       community contexts).
 *     - visibility = public/friends/private: the SAME row also appears in
 *       community contexts under the normal community rules (one row, not a
 *       copy — authored in a room but shared outward).
 * With no viewer (unauthenticated / list contexts) only public rows are
 * visible.
 * Pass `roomIdCol` whenever the table has a room scope column (comments,
 * user_highlights) so room-only content never leaks outside its room.
 *
 * `allowViewerRooms` controls the members-only room branch:
 *   - false (default, LIST contexts: community overlays, feeds, profiles,
 *     counts): 'room'-visibility rows are excluded entirely — they only show
 *     when a route explicitly filters by a roomId the viewer belongs to.
 *   - true (ID-ADDRESSED contexts: open a specific comment/thread from a
 *     notification or room feed): room rows are visible to that room's members.
 */
export function visibilityPredicate(
  visibilityCol: AnyPgColumn,
  authorCol: AnyPgColumn,
  viewer?: Viewer,
  roomIdCol?: AnyPgColumn,
  allowViewerRooms = false,
): SQL {
  let communityClause: SQL;
  if (!viewer) {
    communityClause = eq(visibilityCol, "public");
  } else {
    const clauses: (SQL | undefined)[] = [
      eq(visibilityCol, "public"),
      eq(authorCol, viewer.userId),
    ];
    if (viewer.mutualIds.length > 0) {
      clauses.push(
        and(
          eq(visibilityCol, "friends"),
          inArray(authorCol, viewer.mutualIds),
        ),
      );
    }
    communityClause = or(...clauses)!;
  }

  let visible: SQL;
  if (!roomIdCol) {
    visible = communityClause;
  } else {
    // Community contexts see community rows AND room rows the author explicitly
    // shared outward (visibility != 'room'); members-only rows stay in-room.
    const scoped: (SQL | undefined)[] = [
      and(or(isNull(roomIdCol), ne(visibilityCol, "room")), communityClause),
    ];
    if (allowViewerRooms && viewer && viewer.roomIds.length > 0) {
      scoped.push(inArray(roomIdCol, viewer.roomIds));
    }
    visible = or(...scoped)!;
  }

  if (!viewer || viewer.blockedIds.length === 0) return visible;
  return and(visible, notInArray(authorCol, viewer.blockedIds))!;
}
