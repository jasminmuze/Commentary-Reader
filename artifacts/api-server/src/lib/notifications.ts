import { eq, inArray } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { sendPushToUsers } from "./push";

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
  return actor?.username ?? "누군가";
}

export interface NotificationPrefs {
  notifyLikes: boolean;
  notifyReplies: boolean;
  notifyMentions: boolean;
  notifyFriends: boolean;
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
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return (
    user ?? {
      notifyLikes: true,
      notifyReplies: true,
      notifyMentions: true,
      notifyFriends: true,
    }
  );
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
      title:
        type === "highlight_like"
          ? `@${actorUsername}님이 회원님의 하이라이트를 좋아해요`
          : `@${actorUsername}님이 회원님의 댓글을 좋아해요`,
      body: previewText,
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
}): Promise<void> {
  const { text, actorId, commentId } = options;
  const excluded = new Set<number>(options.excludeUserIds ?? []);
  excluded.add(actorId);

  const mentionedNames = parseMentionedUsernames(text);
  if (mentionedNames.length === 0) return;

  const mentionedUsers = await db
    .select({ id: usersTable.id, notifyMentions: usersTable.notifyMentions })
    .from(usersTable)
    .where(inArray(usersTable.username, mentionedNames));
  // Respect each recipient's mention-notification setting (skips in-app AND push).
  const toNotify = mentionedUsers.filter(
    (u) => !excluded.has(u.id) && u.notifyMentions,
  );
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
        title: `@${actorUsername}님이 회원님을 언급했어요`,
        body: text,
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
}): void {
  const { recipientId, actorId, commentId, text } = options;
  void (async () => {
    const actorUsername = await getActorUsername(actorId);
    await sendPushToUsers([recipientId], {
      title: `@${actorUsername}님이 회원님의 댓글에 답글을 남겼어요`,
      body: text,
      data: { type: "reply", commentId },
    });
  })();
}
