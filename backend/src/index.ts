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
    .then(({ requeueStuckRecipients }) => requeueStuckRecipients({ take: 40 }))
    .then((n) => {
      if (n > 0) logger.info({ n }, "SMS file reprise au démarrage");
    })
    .catch((err) => logger.error({ err }, "requeue au démarrage échoué"));

  setInterval(() => {
    markStaleDevicesOffline().catch((err) => logger.error({ err }, "offline sweep failed"));
  }, 60_000);

  setInterval(() => {
    import("./queues/smsQueue.js")
      .then(({ requeueStuckRecipients }) => requeueStuckRecipients({ take: 25 }))
      .then((n) => {
        if (n > 0) logger.info({ n }, "stuck SMS requeued");
      })
      .catch((err) => logger.error({ err }, "stuck sms sweep failed"));
  }, 10 * 60_000);

  setInterval(() => {
    const cutoff = new Date(Date.now() - 180_000);
    prisma.campaignRecipient
      .findMany({
        where: { status: "SENDING", updatedAt: { lt: cutoff } },
        include: { simLine: true, campaign: { select: { name: true } } },
      })
      .then(async (stuck) => {
        if (stuck.length === 0) return;
        const { enqueueSmsJobs } = await import("./queues/smsQueue.js");
        const { isContestSms } = await import("./utils/campaign.js");
        const contestPending = stuck.some((r) =>
          isContestSms({ campaignName: r.campaign.name, message: r.message }),
        )
          ? true
          : (await prisma.campaignRecipient.count({
              where: {
                status: { in: ["QUEUED", "SENDING"] },
                OR: [
                  { campaign: { name: { startsWith: "Concours SMS" } } },
                  { message: { contains: "jeu concours", mode: "insensitive" } },
                  { message: { contains: "10 ans Boxing Center", mode: "insensitive" } },
                ],
                NOT: { campaign: { name: { startsWith: "Boutique SMS" } } },
              },
            })) > 0;
        const retry = contestPending
          ? stuck.filter((r) => isContestSms({ campaignName: r.campaign.name, message: r.message }))
          : stuck;
        if (retry.length === 0) return;
        await prisma.campaignRecipient.updateMany({
          where: { id: { in: retry.map((s) => s.id) } },
          data: {
            status: "QUEUED",
            errorCode: "SMS_FAILED",
            errorDetail: "envoi bloqué, nouvelle tentative",
          },
        });
        await enqueueSmsJobs(
          retry.map((r) => ({
            recipientId: r.id,
            campaignId: r.campaignId,
            contactId: r.contactId,
            phoneNumber: r.phoneNumber,
            message: r.message,
            preferredSim: r.simLine?.slot ?? undefined,
          })),
          { priority: contestPending ? 1 : 10 },
        );
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
