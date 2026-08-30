import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, "CRM DC API listening"));
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
