import { Router, type IRouter } from "express";
import healthRouter from "./health";
import booksRouter from "./books";
import quotesRouter from "./quotes";
import commentsRouter from "./comments";
import libraryRouter from "./library";
import usersRouter from "./users";
import objectsRouter from "./objects";

const router: IRouter = Router();

router.use(healthRouter);
router.use(booksRouter);
router.use(quotesRouter);
router.use(commentsRouter);
router.use(libraryRouter);
router.use(usersRouter);
router.use(objectsRouter);

export default router;
