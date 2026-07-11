import { inArray } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";

/** Extracts @username tokens from comment text (e.g. "nice @jane!" → ["jane"]). */
export function parseMentionedUsernames(text: string): string[] {
  return [...text.matchAll(/\B@(\w+)/g)].map((m) => m[1]!);
}

/**
 * Creates "mention" notifications for every @mentioned user in `text` that
 * actually exists, excluding the actor and any already-notified users.
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
}
