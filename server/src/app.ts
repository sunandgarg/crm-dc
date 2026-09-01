import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { config } from "./config.js";
import { HttpError } from "./http.js";
import { logger } from "./logger.js";
import { authRouter } from "./routes/auth.js";
import { dataRouter } from "./routes/data.js";
import { functionsRouter } from "./routes/functions.js";
import { rpcRouter } from "./routes/rpc.js";
import { publicFunctionsRouter } from "./routes/publicFunctions.js";
import { storageRouter } from "./routes/storage.js";
import { rateLimit } from "./middleware/rateLimit.js";

export const app = express();
app.disable("x-powered-by");
if (config.TRUST_PROXY) app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: config.APP_URL.split(",").map((value) => value.trim()), credentials: true }));
app.use(rateLimit("global", 60_000, config.GLOBAL_RATE_LIMIT_PER_MINUTE));
app.use(express.json({
  limit: "20mb",
  verify: (request, _response, buffer) => {
    if (request.url?.includes("/api/functions/meta-lead-webhook")) (request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));
app.use(pinoHttp({ logger, genReqId: (request, response) => {
  const id = String(request.headers["x-request-id"] || crypto.randomUUID());
  response.setHeader("x-request-id", id);
  return id;
} }));
app.get("/api/health", (_request, response) => response.json({ status: "ok", service: "crm-dc-api", timestamp: new Date().toISOString() }));
app.get("/api/readiness", async (_request, response) => {
  try {
    await import("./db.js").then(({ prisma }) => prisma.$queryRaw`SELECT 1`);
    response.json({ status: "ready", database: "connected", timestamp: new Date().toISOString() });
  } catch {
    response.status(503).json({ status: "not-ready", database: "unavailable", timestamp: new Date().toISOString() });
  }
});
app.use("/api/auth", rateLimit("auth", 15 * 60_000, config.AUTH_RATE_LIMIT_PER_15_MINUTES), authRouter);
app.use("/api/functions", rateLimit("public", 60_000, config.PUBLIC_RATE_LIMIT_PER_MINUTE), publicFunctionsRouter);
app.use("/api/data", dataRouter);
app.use("/api/rpc", rpcRouter);
app.use("/api/functions", functionsRouter);
app.use("/api/storage", storageRouter);
app.use((_request, response) => response.status(404).json({ error: "Route not found" }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return response.status(400).json({ error: "Validation failed", details: error.flatten() });
  if (error instanceof HttpError) return response.status(error.status).json({ error: error.message });
  logger.error({ err: error }, "Unhandled request error");
  response.status(500).json({ error: "Internal server error" });
});
