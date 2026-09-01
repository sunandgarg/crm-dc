import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { startBatchScheduler } from "./services/batchProcessor.js";

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, "CRM DC API listening"));
const stopScheduler = config.SCHEDULER_ENABLED ? startBatchScheduler(config.SCHEDULER_INTERVAL_SECONDS) : () => undefined;
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  stopScheduler();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
server.requestTimeout = 310_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 60_000;
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
