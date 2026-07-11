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
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.username, mentionedNames));
  const toNotify = mentionedUsers.filter((u) => !excluded.has(u.id));
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
