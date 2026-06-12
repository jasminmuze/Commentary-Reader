import { Router, type IRouter } from "express";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";

const router: IRouter = Router();

// Returns a presigned PUT URL the client uploads the EPUB directly to.
// Public file uploading: no auth (the app has no real authentication).
router.post("/objects/upload", async (_req, res): Promise<void> => {
  const svc = new ObjectStorageService();
  const uploadURL = await svc.getObjectEntityUploadURL();
  res.json({ uploadURL });
});

// Serves an uploaded EPUB, enforcing the object's ACL. The requester identifies
// itself with ?userId= (the app's existing client-supplied identity model); only
// the owner (or a public object) may read. Real authentication is a follow-up.
// Express 5 named wildcard; reconstruct the "/objects/..." path manually because
// the router is mounted at /api (so req.path would be prefixed and break
// getObjectEntityFile's startsWith("/objects/")).
router.get("/objects/*objectPath", async (req, res): Promise<void> => {
  const svc = new ObjectStorageService();
  const splat = (req.params as Record<string, unknown>)["objectPath"];
  const rest = Array.isArray(splat) ? splat.join("/") : String(splat ?? "");
  const objectPath = `/objects/${rest}`;
  const userId =
    typeof req.query.userId === "string" ? req.query.userId : undefined;
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
