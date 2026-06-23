import { db, friendshipsTable } from "@workspace/db";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
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
}

/** Build a Viewer (with its mutual-friend set) for visibility filtering. */
export async function getViewer(userId: number): Promise<Viewer> {
  return { userId, mutualIds: await getMutualFriendIds(userId) };
}

/**
 * SQL predicate restricting visibility-gated rows (comments / highlights) to
 * what `viewer` may see:
 *   - public rows
 *   - the viewer's own rows
 *   - friends-only rows authored by a mutual friend
 * With no viewer (unauthenticated / list contexts) only public rows are visible.
 */
export function visibilityPredicate(
  visibilityCol: AnyPgColumn,
  authorCol: AnyPgColumn,
  viewer?: Viewer,
): SQL {
  if (!viewer) {
    return eq(visibilityCol, "public");
  }
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
  return or(...clauses)!;
}
