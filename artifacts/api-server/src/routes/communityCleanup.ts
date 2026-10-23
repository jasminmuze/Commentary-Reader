import { buildCleanupPlan, CleanupPreconditionError, KEEP_USERNAMES } from "../lib/communityCleanupPlan.js";
import { CLEANUP_PAGE } from "../pages/communityCleanupPage.js";
import { Router, type IRouter } from "express";
import {
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  communityCleanupRunsTable,
  commentLikesTable,
  commentSavesTable,
  commentsTable,
  db,
  friendRequestsTable,
  friendshipsTable,
  highlightLikesTable,
  notificationsTable,
  readingRoomsTable,
  roomInvitesTable,
  roomMembersTable,
  userHighlightsTable,
  usersTable,
} from "@workspace/db";
import { acquireAccountRequestLocks } from "../lib/accountRequestLocks.js";
import {
  authenticate,
  authenticateWithoutAccountLocks,
} from "../middlewares/authenticate.js";

const router: IRouter = Router();
const SCOPE_KEY = "prelaunch-community-cleanup-v1";
const REQUIRED_CONFIRMATION = "DELETE COMMUNITY RECORDS";

function adminUserId(): number | null {
  const value = Number(process.env.COMMUNITY_CLEANUP_ADMIN_USER_ID);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function applyEnabled(): boolean {
  return process.env.COMMUNITY_CLEANUP_APPLY_ENABLED === "true";
}

function isCleanupAdmin(userId: number): boolean {
  const configuredAdminId = adminUserId();
  return configuredAdminId !== null && configuredAdminId === userId;
}

function requireAdmin(req: Parameters<typeof authenticate>[0], res: Parameters<typeof authenticate>[1]): boolean {
  if (!isCleanupAdmin(req.userId)) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}

router.get("/admin/community-cleanup", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(CLEANUP_PAGE);
});

router.get("/admin/community-cleanup/preview", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const [existingRun] = await db
      .select({ appliedAt: communityCleanupRunsTable.appliedAt })
      .from(communityCleanupRunsTable)
      .where(eq(communityCleanupRunsTable.scopeKey, SCOPE_KEY))
      .limit(1);
    const plan = await buildCleanupPlan();
    res.json({
      state: existingRun ? "already_applied" : "ready",
      keepUsernames: KEEP_USERNAMES,
      targetAccountCount: plan.targetAccountCount,
      counts: plan.counts,
      snapshotHash: plan.snapshotHash,
      applyEnabled: applyEnabled(),
      appliedAt: existingRun?.appliedAt ?? null,
    });
  } catch (err) {
    if (err instanceof CleanupPreconditionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Community cleanup preview failed");
    res.status(500).json({ error: "Could not build a safe cleanup preview" });
  }
});

router.post(
  "/admin/community-cleanup/apply",
  authenticateWithoutAccountLocks,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!applyEnabled()) {
      res.status(403).json({ error: "Cleanup apply is disabled" });
      return;
    }
    if (
      req.body?.confirmation !== REQUIRED_CONFIRMATION ||
      typeof req.body?.snapshotHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(req.body.snapshotHash)
    ) {
      res.status(400).json({ error: "A current preview and exact confirmation are required" });
      return;
    }

    let releaseLock: (() => Promise<void>) | undefined;
    try {
      // The cleanup route deliberately skipped the normal shared lock in
      // authenticateWithoutAccountLocks. This exclusive global lock fences
      // every authenticated writer while the snapshot is rechecked and applied.
      releaseLock = await acquireAccountRequestLocks(req.userId, "exclusive");
      const [currentAdmin] = await db
        .select({ username: usersTable.username, deletionPending: usersTable.deletionPending })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId))
        .limit(1);
      if (!currentAdmin || currentAdmin.deletionPending || currentAdmin.username !== "bookworm") {
        res.status(401).json({ error: "Administrator authentication is no longer valid" });
        return;
      }
      const plan = await buildCleanupPlan();
      if (plan.snapshotHash !== req.body.snapshotHash) {
        res.status(409).json({
          error: "Community data changed since preview. Refresh the preview before continuing.",
        });
        return;
      }

      await db.transaction(async (tx) => {
        const [alreadyApplied] = await tx
          .select({ scopeKey: communityCleanupRunsTable.scopeKey })
          .from(communityCleanupRunsTable)
          .where(eq(communityCleanupRunsTable.scopeKey, SCOPE_KEY))
          .limit(1);
        if (alreadyApplied) {
          throw new Error("This one-time cleanup has already been applied");
        }

        await tx.insert(communityCleanupRunsTable).values({
          scopeKey: SCOPE_KEY,
          requestedByUserId: req.userId,
          previewHash: plan.snapshotHash,
          affectedCounts: plan.counts,
        });

        if (plan.replyIdsToDetach.length) {
          await tx
            .update(commentsTable)
            .set({ parentId: null })
            .where(inArray(commentsTable.id, plan.replyIdsToDetach));
        }

        if (plan.commentLikeIdsToDelete.length) {
          await tx
            .delete(commentLikesTable)
            .where(inArray(commentLikesTable.id, plan.commentLikeIdsToDelete));
        }
        if (plan.commentSaveIdsToDelete.length) {
          await tx
            .delete(commentSavesTable)
            .where(inArray(commentSavesTable.id, plan.commentSaveIdsToDelete));
        }
        for (const commentId of plan.affectedCommentIdsWithSurvivingLikes) {
          await tx
            .update(commentsTable)
            .set({
              likeCount: sql`(SELECT COUNT(*)::int FROM comment_likes WHERE comment_id = ${commentId})`,
            })
            .where(eq(commentsTable.id, commentId));
        }
        if (plan.highlightLikeIdsToDelete.length) {
          await tx
            .delete(highlightLikesTable)
            .where(inArray(highlightLikesTable.id, plan.highlightLikeIdsToDelete));
        }
        if (plan.notificationIdsToDelete.length) {
          await tx
            .delete(notificationsTable)
            .where(inArray(notificationsTable.id, plan.notificationIdsToDelete));
        }
        if (plan.commentIdsToDelete.length) {
          await tx
            .delete(commentsTable)
            .where(inArray(commentsTable.id, plan.commentIdsToDelete));
        }
        if (plan.highlightIdsToDelete.length) {
          await tx
            .delete(userHighlightsTable)
            .where(inArray(userHighlightsTable.id, plan.highlightIdsToDelete));
        }
        if (plan.friendshipIdsToDelete.length) {
          await tx
            .delete(friendshipsTable)
            .where(inArray(friendshipsTable.id, plan.friendshipIdsToDelete));
        }
        if (plan.friendRequestIdsToDelete.length) {
          await tx
            .delete(friendRequestsTable)
            .where(inArray(friendRequestsTable.id, plan.friendRequestIdsToDelete));
        }
        if (plan.roomInviteIdsToDelete.length) {
          await tx
            .delete(roomInvitesTable)
            .where(inArray(roomInvitesTable.id, plan.roomInviteIdsToDelete));
        }
        if (plan.roomMemberIdsToDelete.length) {
          await tx
            .delete(roomMembersTable)
            .where(inArray(roomMembersTable.id, plan.roomMemberIdsToDelete));
        }
        if (plan.roomIdsToArchive.length) {
          await tx
            .update(readingRoomsTable)
            .set({ ownerId: null, isPublic: false })
            .where(inArray(readingRoomsTable.id, plan.roomIdsToArchive));
          await tx
            .update(roomMembersTable)
            .set({ role: "member" })
            .where(inArray(roomMembersTable.roomId, plan.roomIdsToArchive));
        }
        if (plan.roomIdsToDelete.length) {
          await tx
            .delete(readingRoomsTable)
            .where(inArray(readingRoomsTable.id, plan.roomIdsToDelete));
        }
      });

      res.json({ ok: true, state: "applied", counts: plan.counts });
    } catch (err) {
      if (err instanceof CleanupPreconditionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      req.log.error({ err, userId: req.userId }, "Community cleanup apply failed");
      const message = err instanceof Error ? err.message : "";
      if (message.includes("already been applied")) {
        res.status(409).json({ error: "This one-time cleanup has already been applied" });
        return;
      }
      res.status(500).json({ error: "Cleanup failed; no partial changes were committed" });
    } finally {
      if (releaseLock) {
        try {
          await releaseLock();
        } catch (err) {
          req.log.error({ err, userId: req.userId }, "Failed to release cleanup lock");
        }
      }
    }
  },
);


export default router;
