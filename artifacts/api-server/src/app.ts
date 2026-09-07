import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(
  "/api/transcribe",
  express.raw({
    type: (req) =>
      req.headers["content-type"]?.startsWith("multipart/form-data") ?? false,
    limit: "25mb",
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

/**
 * Global error boundary. Route handlers already catch and sanitize their
 * own errors (see customers.ts) and never call next(err) — this exists
 * for errors thrown *before* a route handler runs, which the only
 * concrete case today is a malformed request body failing express.json()
 * or express.urlencoded(). Registered last, per Express's requirement
 * that error-handling middleware (4 arguments) come after everything else.
 *
 * Never exposes a stack trace, filesystem path, or other internal detail
 * to the client — full detail still goes to the server-side logger.
 */
const globalErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // Express's own documented shape for a malformed-body parse failure.
  if (err instanceof SyntaxError && "body" in err) {
    req.log.error({ err }, "Malformed request body");
    res.status(400).json({ error: "Malformed request body." });
    return;
  }

  req.log.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Something went wrong." });
};

app.use(globalErrorHandler);

export default app;
