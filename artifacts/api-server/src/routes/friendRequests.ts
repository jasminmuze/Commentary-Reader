import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  friendRequestsTable,
  friendshipsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import {
  SendFriendRequestBody,
  AcceptFriendRequestParams,
  DeclineFriendRequestParams,
} from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate.js";
import { sendPushToUsers } from "../lib/push";
import { getNotificationPrefs } from "../lib/notifications";
import {
  friendAcceptPushCopy,
  friendRequestPushCopy,
} from "../lib/notificationCopy";

const router: IRouter = Router();

// POST /friend-requests — send a friend request (requester = authenticated user).
// Idempotent: re-sending while pending, or when already friends, returns ok
// without creating duplicate rows or duplicate notifications.
router.post("/friend-requests", authenticate, async (req, res): Promise<void> => {
  const body = SendFriendRequestBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const requesterId = req.userId;
  const { recipientId } = body.data;

  if (requesterId === recipientId) {
    res.status(400).json({ error: "Cannot send a friend request to yourself" });
    return;
  }

  const [recipient] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, recipientId));
  if (!recipient) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Already friends (mutual follow)? Nothing to do.
  const [iFollow] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.userId, requesterId),
        eq(friendshipsTable.friendId, recipientId),
      ),
    );
  const [followsMe] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.userId, recipientId),
        eq(friendshipsTable.friendId, requesterId),
      ),
    );
  if (iFollow && followsMe) {
    res.json({ ok: true });
    return;
  }

  // If the other user already has a pending request TO me, sending one back
  // is effectively mutual consent — accept it directly.
  const [reverse] = await db
    .select()
    .from(friendRequestsTable)
    .where(
      and(
        eq(friendRequestsTable.requesterId, recipientId),
        eq(friendRequestsTable.recipientId, requesterId),
      ),
    );
  if (reverse) {
    await acceptRequest(reverse.requesterId, requesterId);
    res.json({ ok: true });
    return;
  }

  // Race-free insert; only notify when a new row was actually created.
  const inserted = await db
    .insert(friendRequestsTable)
    .values({ requesterId, recipientId })
    .onConflictDoNothing()
    .returning();

  // Skipped entirely (in-app AND push) when the recipient disabled friend
  // notifications. They can still see and act on pending requests elsewhere.
  if (inserted.length > 0) {
    const prefs = await getNotificationPrefs(recipientId);
    if (prefs.notifyFriends) {
      await db.insert(notificationsTable).values({
        userId: recipientId,
        type: "friend_request",
        actorId: requesterId,
      });

      void (async () => {
        const [requester] = await db
          .select({ username: usersTable.username })
          .from(usersTable)
          .where(eq(usersTable.id, requesterId));
        await sendPushToUsers([recipientId], {
          ...friendRequestPushCopy(requester?.username),
          data: { type: "friend_request", requesterId },
        });
      })();
    }
  }

  res.json({ ok: true });
});

/**
 * Accepts the pending request (requesterId -> recipientId): removes the
 * request row, creates the mutual follow, marks the recipient's
 * friend_request notification(s) from this requester as read, notifies the
 * requester, and fires a best-effort push.
 * Returns false when no pending request existed.
 */
async function acceptRequest(
  requesterId: number,
  recipientId: number,
): Promise<boolean> {
  // All-or-nothing: request deletion, mutual follows, and notifications must
  // not end up in a partial state if any step fails.
  const requesterPrefs = await getNotificationPrefs(requesterId);
  const accepted = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.requesterId, requesterId),
          eq(friendRequestsTable.recipientId, recipientId),
        ),
      )
      .returning();
    if (deleted.length === 0) return false;

    // Mutual follow — keeps the existing "mutual follow = friends" visibility
    // logic working unchanged.
    await tx
      .insert(friendshipsTable)
      .values([
        { userId: requesterId, friendId: recipientId },
        { userId: recipientId, friendId: requesterId },
      ])
      .onConflictDoNothing();

    // The request card is now resolved — mark it read.
    await tx
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.userId, recipientId),
          eq(notificationsTable.actorId, requesterId),
          eq(notificationsTable.type, "friend_request"),
        ),
      );

    // Skipped entirely (in-app AND push) when the requester disabled friend
    // notifications; the friendship itself is still created above.
    if (requesterPrefs.notifyFriends) {
      await tx.insert(notificationsTable).values({
        userId: requesterId,
        type: "friend_accept",
        actorId: recipientId,
      });
    }

    return true;
  });
  if (!accepted) return false;

  if (requesterPrefs.notifyFriends) {
    void (async () => {
      const [recipient] = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, recipientId));
      await sendPushToUsers([requesterId], {
        ...friendAcceptPushCopy(recipient?.username),
        data: { type: "friend_accept", userId: recipientId },
      });
    })();
  }

  return true;
}

// POST /friend-requests/:requesterId/accept — recipient accepts.
router.post(
  "/friend-requests/:requesterId/accept",
  authenticate,
  async (req, res): Promise<void> => {
    const params = AcceptFriendRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const ok = await acceptRequest(params.data.requesterId, req.userId);
    if (!ok) {
      res.status(404).json({ error: "No pending friend request from this user" });
      return;
    }
    res.json({ ok: true });
  },
);

// POST /friend-requests/:requesterId/decline — recipient declines. The row is
// deleted so the requester may request again later.
router.post(
  "/friend-requests/:requesterId/decline",
  authenticate,
  async (req, res): Promise<void> => {
    const params = DeclineFriendRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const declined = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.requesterId, params.data.requesterId),
            eq(friendRequestsTable.recipientId, req.userId),
          ),
        )
        .returning();
      if (deleted.length === 0) return false;

      // Resolve the notification card quietly.
      await tx
        .update(notificationsTable)
        .set({ read: true })
        .where(
          and(
            eq(notificationsTable.userId, req.userId),
            eq(notificationsTable.actorId, params.data.requesterId),
            eq(notificationsTable.type, "friend_request"),
          ),
        );

      return true;
    });

    if (!declined) {
      res.status(404).json({ error: "No pending friend request from this user" });
      return;
    }

    res.json({ ok: true });
  },
);

export default router;
