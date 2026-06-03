import { Router, type IRouter } from "express";
import healthRouter from "./health";
import booksRouter from "./books";
import commentsRouter from "./comments";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(booksRouter);
router.use(commentsRouter);
router.use(usersRouter);

export default router;
