import { eq, inArray } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;
const BODY_PREVIEW_MAX = 160;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data?: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

function truncateBody(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > BODY_PREVIEW_MAX
    ? `${collapsed.slice(0, BODY_PREVIEW_MAX - 1)}…`
    : collapsed;
}

/**
 * Sends push notifications to every registered device of the given users via
 * the Expo Push API. Best-effort: never throws; errors are logged. Tokens
 * rejected as DeviceNotRegistered are pruned from the database.
 */
export async function sendPushToUsers(
  userIds: number[],
  notification: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    if (userIds.length === 0) return;

    const tokens = await db
      .select()
      .from(pushTokensTable)
      .where(inArray(pushTokensTable.userId, userIds));
    if (tokens.length === 0) return;

    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title: notification.title,
      body: truncateBody(notification.body),
      sound: "default",
      data: notification.data,
    }));

    const deadTokens: string[] = [];

    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      const chunk = messages.slice(i, i + CHUNK_SIZE);
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(chunk),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.warn(
          { status: res.status, body: text.slice(0, 500) },
          "Expo push API request failed",
        );
        continue;
      }

      const payload = (await res.json()) as { data?: ExpoPushTicket[] };
      const tickets = payload.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "error") {
          const target = chunk[idx]?.to;
          logger.warn(
            { error: ticket.details?.error, message: ticket.message },
            "Expo push ticket error",
          );
          if (ticket.details?.error === "DeviceNotRegistered" && target) {
            deadTokens.push(target);
          }
        }
      });
    }

    if (deadTokens.length > 0) {
      await db
        .delete(pushTokensTable)
        .where(inArray(pushTokensTable.token, deadTokens));
      logger.info(
        { count: deadTokens.length },
        "Pruned unregistered Expo push tokens",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to send Expo push notifications");
  }
}

/** Removes every stored push token matching `token` (any user). */
export async function deletePushToken(token: string): Promise<void> {
  await db.delete(pushTokensTable).where(eq(pushTokensTable.token, token));
}
