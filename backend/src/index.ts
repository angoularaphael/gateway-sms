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
  import("./queues/smsQueue.js")
    .then(({ requeueStuckRecipients }) => requeueStuckRecipients({ take: 3 }))
    .then((n) => {
      if (n > 0) logger.info({ n }, "SMS file reprise au démarrage");
    })
    .catch((err) => logger.error({ err }, "requeue au démarrage échoué"));

  setInterval(() => {
    markStaleDevicesOffline().catch((err) => logger.error({ err }, "offline sweep failed"));
  }, 60_000);

  setInterval(() => {
    import("./queues/smsQueue.js")
      .then(({ requeueStuckRecipients }) => requeueStuckRecipients({ take: 3 }))
      .then((n) => {
        if (n > 0) logger.info({ n }, "stuck SMS requeued");
      })
      .catch((err) => logger.error({ err }, "stuck sms sweep failed"));
  }, 10 * 60_000);

  setInterval(() => {
    const cutoff = new Date(Date.now() - 180_000);
    prisma.campaignRecipient
      .updateMany({
        where: { status: "SENDING", updatedAt: { lt: cutoff } },
        data: { status: "QUEUED", errorCode: null, errorDetail: "envoi interrompu, nouvel essai" },
      })
      .catch((err) => logger.error({ err }, "sending sweep failed"));
  }, 120_000);

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
  }, 60_000);

  server.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, "SMS Gateway API listening");
  });
}

main().catch(async (err) => {
  logger.fatal({ err }, "startup failed");
  await prisma.$disconnect();
  process.exit(1);
});
