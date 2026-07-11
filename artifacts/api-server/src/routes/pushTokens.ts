import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import {
  RegisterPushTokenParams,
  RegisterPushTokenBody,
  UnregisterPushTokenParams,
  UnregisterPushTokenBody,
} from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

// POST /users/:userId/push-tokens — register (upsert) an Expo push token.
// A token is unique per device; re-registering under a different account
// reassigns it so pushes never leak to a previously logged-in user.
router.post("/users/:userId/push-tokens", authenticate, async (req, res): Promise<void> => {
  const params = RegisterPushTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = RegisterPushTokenBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  await db
    .insert(pushTokensTable)
    .values({ userId: req.userId, token: body.data.token })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: { userId: req.userId },
    });

  res.json({ ok: true });
});

// DELETE /users/:userId/push-tokens — unregister a token (e.g. on logout).
// Idempotent; only removes the token if it belongs to the authenticated user.
router.delete("/users/:userId/push-tokens", authenticate, async (req, res): Promise<void> => {
  const params = UnregisterPushTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = UnregisterPushTokenBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  await db
    .delete(pushTokensTable)
    .where(
      and(
        eq(pushTokensTable.userId, req.userId),
        eq(pushTokensTable.token, body.data.token),
      ),
    );

  res.json({ ok: true });
});

export default router;
