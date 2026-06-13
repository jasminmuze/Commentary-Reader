import { Router, type IRouter } from "express";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

// Returns a presigned PUT URL the client uploads the EPUB directly to.
router.post("/objects/upload", authenticate, async (_req, res): Promise<void> => {
  const svc = new ObjectStorageService();
  const uploadURL = await svc.getObjectEntityUploadURL();
  res.json({ uploadURL });
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
