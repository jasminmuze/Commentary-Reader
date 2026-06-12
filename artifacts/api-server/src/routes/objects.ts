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

// Serves uploaded objects publicly. Express 5 named wildcard; reconstruct the
// "/objects/..." path manually because the router is mounted at /api (so req.path
// would be prefixed and break getObjectEntityFile's startsWith("/objects/")).
router.get("/objects/*objectPath", async (req, res): Promise<void> => {
  const svc = new ObjectStorageService();
  const splat = (req.params as Record<string, unknown>)["objectPath"];
  const rest = Array.isArray(splat) ? splat.join("/") : String(splat ?? "");
  const objectPath = `/objects/${rest}`;
  try {
    const file = await svc.getObjectEntityFile(objectPath);
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
