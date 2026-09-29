import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken } from "../lib/auth.js";
import {
  acquireAccountRequestLocks,
  releaseAccountRequestLocksOnResponse,
} from "../lib/accountRequestLocks.js";

declare global {
  namespace Express {
    interface Request {
      userId: number;
    }
  }
}

/**
 * Require a valid `Authorization: Bearer <token>` header.
 * Sets req.userId from the verified token; returns 401 otherwise.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = verifyToken(authHeader.slice(7));
  if (userId === null) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const isDeleteAccountRequest =
    req.method === "DELETE" &&
    req.path.replace(/\/+$/, "") === `/users/${userId}`;
  const isMutatingRequest = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  let releaseAccountLocks: (() => Promise<void>) | undefined;
  if (isMutatingRequest) {
    try {
      releaseAccountLocks = await acquireAccountRequestLocks(
        userId,
        isDeleteAccountRequest ? "exclusive" : "shared",
      );
      if (req.aborted) {
        await releaseAccountLocks();
        return;
      }
      const responseCanContinue = releaseAccountRequestLocksOnResponse(res, releaseAccountLocks, (err) => {
        req.log.error({ err, userId }, "Failed to release account request locks");
      });
      if (!responseCanContinue) return;
    } catch (err) {
      req.log.error({ err, userId }, "Failed to acquire account request locks");
      res.status(503).json({ error: "Account operation could not be safely started" });
      return;
    }
  }

  // Tokens are stateless, so verify the account still exists. This revokes
  // every outstanding bearer token immediately after permanent deletion. For
  // mutations this read happens after the advisory lock, so a request that
  // waited behind deletion cannot continue using a stale authentication check.
  const [user] = await db
    .select({ id: usersTable.id, deletionPending: usersTable.deletionPending })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || (user.deletionPending && !isDeleteAccountRequest)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
