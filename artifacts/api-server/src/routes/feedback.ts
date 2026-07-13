import { Router, type IRouter } from "express";
import { db, feedbackTable } from "@workspace/db";
import { SubmitFeedbackBody } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

// POST /feedback — store in-app feedback or a bug report from the
// authenticated user. Write-only for now (no admin view yet).
router.post("/feedback", authenticate, async (req, res): Promise<void> => {
  const body = SubmitFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  await db.insert(feedbackTable).values({
    userId: req.userId!,
    type: body.data.type,
    text: body.data.text.trim(),
  });

  res.status(201).json({ ok: true });
});

export default router;
