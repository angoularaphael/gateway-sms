import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { attachGatewaySocket } from "./websocket/gateway.js";
import { startSmsWorker } from "./workers/smsWorker.js";
import { markStaleDevicesOffline } from "./services/deviceService.js";
import { prisma } from "./utils/prisma.js";
import { startCampaign } from "./services/campaignService.js";

async function main() {
  const app = createApp();
  const server = createServer(app);
  attachGatewaySocket(server);
  startSmsWorker();

  setInterval(() => {
    markStaleDevicesOffline().catch((err) => logger.error({ err }, "offline sweep failed"));
  }, 30_000);

  setInterval(() => {
    prisma.campaign
      .findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      })
      .then(async (due) => {
        for (const c of due) {
          await startCampaign(c.id).catch((err) => logger.error({ err, id: c.id }, "scheduled start failed"));
        }
      })
      .catch((err) => logger.error({ err }, "schedule sweep failed"));
  }, 30_000);

  server.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, "SMS Gateway API listening");
  });
}

main().catch(async (err) => {
  logger.fatal({ err }, "startup failed");
  await prisma.$disconnect();
  process.exit(1);
});
