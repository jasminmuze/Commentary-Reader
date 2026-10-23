import { Router, type IRouter } from "express";
import healthRouter from "./health";
import booksRouter from "./books";
import quotesRouter from "./quotes";
import commentsRouter from "./comments";
import libraryRouter from "./library";
import usersRouter from "./users";
import objectsRouter from "./objects";
import notificationsRouter from "./notifications";
import pushTokensRouter from "./pushTokens";
import friendRequestsRouter from "./friendRequests";
import feedRouter from "./feed";
import feedbackRouter from "./feedback";
import roomsRouter from "./rooms";
import communityCleanupRouter from "./communityCleanup";

const router: IRouter = Router();

router.use(healthRouter);
router.use(booksRouter);
router.use(quotesRouter);
router.use(commentsRouter);
router.use(libraryRouter);
router.use(usersRouter);
router.use(objectsRouter);
router.use(notificationsRouter);
router.use(pushTokensRouter);
router.use(friendRequestsRouter);
router.use(feedRouter);
router.use(feedbackRouter);
router.use(roomsRouter);
router.use(communityCleanupRouter);

export default router;
