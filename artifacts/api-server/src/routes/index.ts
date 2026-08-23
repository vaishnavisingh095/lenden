import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transcribeRouter from "./transcribe";
import extractRouter from "./extract";
import customersRouter from "./customers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transcribeRouter);
router.use(extractRouter);
router.use(customersRouter);

export default router;
