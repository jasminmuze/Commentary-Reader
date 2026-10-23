import { and, eq, inArray } from "drizzle-orm";
import { db, notificationsTable, roomMembersTable, usersTable } from "@workspace/db";
import { sendPushToUsers } from "./push";
import { getBlockedUserIds } from "./social";
import {
  commentPushBody,
  likePushCopy,
  mentionPushTitle,
  replyPushTitle,
  roomInvitePushCopy,
} from "./notificationCopy";

/** Extracts @username tokens from comment text (e.g. "nice @jane!" → ["jane"]). */
export function parseMentionedUsernames(text: string): string[] {
  return [...text.matchAll(/\B@(\w+)/g)].map((m) => m[1]!);
}

/** Looks up the actor's username for push copy; falls back to a generic label. */
async function getActorUsername(actorId: number): Promise<string> {
  const [actor] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, actorId));
  return actor?.username ?? null;
}

export interface NotificationPrefs {
  notifyLikes: boolean;
  notifyReplies: boolean;
  notifyMentions: boolean;
  notifyFriends: boolean;
  notifyRooms: boolean;
}

/**
 * Loads a user's per-type notification preferences. Unknown users default to
 * all-on (the caller will fail elsewhere if the user truly doesn't exist).
 */
export async function getNotificationPrefs(
  userId: number,
): Promise<NotificationPrefs> {
  const [user] = await db
    .select({
      notifyLikes: usersTable.notifyLikes,
      notifyReplies: usersTable.notifyReplies,
      notifyMentions: usersTable.notifyMentions,
      notifyFriends: usersTable.notifyFriends,
      notifyRooms: usersTable.notifyRooms,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return (
    user ?? {
      notifyLikes: true,
      notifyReplies: true,
      notifyMentions: true,
      notifyFriends: true,
      notifyRooms: true,
    }
  );
}

/**
 * Creates a room_invite notification for the invitee and fires a best-effort
 * push. Skips entirely (in-app AND push) when the invitee disabled room
 * notifications — the pending invite itself still shows on the room screen.
 * Best-effort: callers should treat failures as non-fatal.
 */
export async function createRoomInviteNotification(options: {
  inviteeId: number;
  inviterId: number;
  roomId: number;
  roomName: string;
}): Promise<void> {
  const { inviteeId, inviterId, roomId, roomName } = options;
  if (inviteeId === inviterId) return;

  const prefs = await getNotificationPrefs(inviteeId);
  if (!prefs.notifyRooms) return;

  await db.insert(notificationsTable).values({
    userId: inviteeId,
    type: "room_invite",
    actorId: inviterId,
    roomId,
  });

  // Push delivery is fire-and-forget: never delays or fails the request.
  void (async () => {
    const actorUsername = await getActorUsername(inviterId);
    await sendPushToUsers([inviteeId], {
      ...roomInvitePushCopy(actorUsername, roomName),
      data: { type: "room_invite", roomId },
    });
  })();
}

/**
 * Creates a highlight_like / comment_like notification for the liked content's
 * owner and fires a best-effort push. Skips entirely (in-app AND push) when
 * the owner is the actor or has likes notifications disabled.
 * Best-effort: callers should treat failures as non-fatal.
 */
export async function createLikeNotification(options: {
  recipientId: number;
  actorId: number;
  type: "highlight_like" | "comment_like";
  highlightId?: number;
  commentId?: number;
  previewText: string;
}): Promise<void> {
  const { recipientId, actorId, type, highlightId, commentId, previewText } =
    options;
  if (recipientId === actorId) return;

  const prefs = await getNotificationPrefs(recipientId);
  if (!prefs.notifyLikes) return;

  await db.insert(notificationsTable).values({
    userId: recipientId,
    type,
    actorId,
    highlightId: highlightId ?? null,
    commentId: commentId ?? null,
  });

  // Push delivery is fire-and-forget: never delays or fails the request.
  void (async () => {
    const actorUsername = await getActorUsername(actorId);
    await sendPushToUsers([recipientId], {
      ...likePushCopy(actorUsername, type, previewText),
      data:
        type === "highlight_like"
          ? { type, highlightId }
          : { type, commentId },
    });
  })();
}

/**
 * Creates "mention" notifications for every @mentioned user in `text` that
 * actually exists, excluding the actor and any already-notified users.
 * Also fires best-effort Expo pushes to the mentioned users' devices.
 * Best-effort: callers should treat failures as non-fatal.
 */
export async function createMentionNotifications(options: {
  text: string;
  actorId: number;
  commentId: number;
  excludeUserIds?: Iterable<number>;
  /** When true, the push body is masked so spoilers never appear on the lock screen. */
  containsSpoilers?: boolean;
  /**
   * When set, mentions only notify members of this room. Used for
   * visibility='room' comments so their text never leaks to non-members
   * via in-app notifications or push bodies.
   */
  restrictToRoomId?: number;
}): Promise<void> {
  const { text, actorId, commentId, containsSpoilers, restrictToRoomId } = options;
  const excluded = new Set<number>(options.excludeUserIds ?? []);
  excluded.add(actorId);

  const mentionedNames = parseMentionedUsernames(text);
  if (mentionedNames.length === 0) return;

  const mentionedUsers = await db
    .select({ id: usersTable.id, notifyMentions: usersTable.notifyMentions })
    .from(usersTable)
    .where(inArray(usersTable.username, mentionedNames));
  const blockedIds = new Set(await getBlockedUserIds(actorId));
  // Respect each recipient's mention-notification setting (skips in-app AND push).
  let toNotify = mentionedUsers.filter(
    (u) => !excluded.has(u.id) && !blockedIds.has(u.id) && u.notifyMentions,
  );
  if (toNotify.length > 0 && restrictToRoomId !== undefined) {
    const memberRows = await db
      .select({ userId: roomMembersTable.userId })
      .from(roomMembersTable)
      .where(
        and(
          eq(roomMembersTable.roomId, restrictToRoomId),
          inArray(
            roomMembersTable.userId,
            toNotify.map((u) => u.id),
          ),
        ),
      );
    const memberIds = new Set(memberRows.map((r) => r.userId));
    toNotify = toNotify.filter((u) => memberIds.has(u.id));
  }
  if (toNotify.length === 0) return;

  await db.insert(notificationsTable).values(
    toNotify.map((u) => ({
      userId: u.id,
      type: "mention" as const,
      actorId,
      commentId,
    })),
  );

  // Push delivery is fire-and-forget: never delays or fails the request.
  void (async () => {
    const actorUsername = await getActorUsername(actorId);
    await sendPushToUsers(
      toNotify.map((u) => u.id),
      {
        title: mentionPushTitle(actorUsername),
        body: commentPushBody(text, containsSpoilers),
        data: { type: "mention", commentId },
      },
    );
  })();
}

/**
 * Fires a best-effort Expo push for a "reply" notification.
 * Never throws; push failures are logged inside sendPushToUsers.
 */
export function sendReplyPush(options: {
  recipientId: number;
  actorId: number;
  commentId: number;
  text: string;
  /** When true, the push body is masked so spoilers never appear on the lock screen. */
  containsSpoilers?: boolean;
}): void {
  const { recipientId, actorId, commentId, text, containsSpoilers } = options;
  void (async () => {
    const actorUsername = await getActorUsername(actorId);
    await sendPushToUsers([recipientId], {
      title: replyPushTitle(actorUsername),
      body: commentPushBody(text, containsSpoilers),
      data: { type: "reply", commentId },
    });
  })();
}
