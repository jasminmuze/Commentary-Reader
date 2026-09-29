import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { db, userObjectUploadsTable, usersTable } from "@workspace/db";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

// Returns a presigned PUT URL the client uploads the EPUB directly to.
router.post("/objects/upload", authenticate, async (req, res): Promise<void> => {
  const svc = new ObjectStorageService();
  try {
    const { uploadURL, objectPath } = await svc.getObjectEntityUploadURL();
    const issued = await db.transaction(async (tx) => {
      const [activeAccount] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, req.userId),
            eq(usersTable.deletionPending, false),
          ),
        )
        .for("share");
      if (!activeAccount) return false;
      await tx.insert(userObjectUploadsTable).values({
        userId: req.userId,
        kind: "epub",
        objectPath,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      return true;
    });
    if (!issued) {
      res.status(409).json({ error: "Account deletion is in progress" });
      return;
    }
    res.json({ uploadURL });
  } catch (err) {
    req.log.error({ err, userId: req.userId }, "Failed to issue owned EPUB upload URL");
    res.status(500).json({ error: "Could not create an EPUB upload" });
  }
});

// Serves public objects (e.g. avatar images) without authentication — these
// live in the public search paths and are world-readable by design, so
// <Image> tags can load them without auth headers.
router.get("/public-objects/*filePath", async (req, res): Promise<void> => {
  const svc = new ObjectStorageService();
  const splat = (req.params as Record<string, unknown>)["filePath"];
  const filePath = Array.isArray(splat) ? splat.join("/") : String(splat ?? "");
  try {
    const file = await svc.searchPublicObject(filePath);
    if (!file) {
      res.sendStatus(404);
      return;
    }
    await svc.downloadObject(file, res, 86400);
  } catch {
    res.sendStatus(500);
  }
});

// Serves an uploaded EPUB, enforcing the object's ACL.
// The requester identity is taken from the verified bearer token (req.userId).
router.get("/objects/*objectPath", authenticate, async (req, res): Promise<void> => {
  const svc = new ObjectStorageService();
  const splat = (req.params as Record<string, unknown>)["objectPath"];
  const rest = Array.isArray(splat) ? splat.join("/") : String(splat ?? "");
  const objectPath = `/objects/${rest}`;
  const userId = String(req.userId);
  try {
    const file = await svc.getObjectEntityFile(objectPath);
    const canAccess = await svc.canAccessObjectEntity({
      userId,
      objectFile: file,
    });
    if (!canAccess) {
      res.sendStatus(403);
      return;
    }
    await svc.downloadObject(file, res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(500);
  }
});

export default router;
