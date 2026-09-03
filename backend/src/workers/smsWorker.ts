import { Worker, DelayedError } from "bullmq";
import { QUEUE_SMS, shouldRetry } from "../utils/campaign.js";
import { selectSimLine } from "../utils/simSelector.js";
import { getRedis } from "../queues/smsQueue.js";
import { prisma } from "../utils/prisma.js";
import { getOnlineSelectableSims } from "../services/deviceService.js";
import { isPhoneUnsubscribed } from "../services/unsubscribeService.js";
import { maybeCompleteCampaign } from "../services/campaignService.js";
import { sendJobToDevice } from "../websocket/gateway.js";
import { removePendingJob } from "../websocket/pendingJobs.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import type { SmsJobPayload } from "../types.js";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function markSimUsed(simId: string, now: Date) {
  const sim = await prisma.simLine.findUniqueOrThrow({ where: { id: simId } });
  const sameDay = sim.sentTodayDate && startOfUtcDay(sim.sentTodayDate).getTime() === startOfUtcDay(now).getTime();
  await prisma.simLine.update({
    where: { id: simId },
    data: {
      lastUsedAt: now,
      sentToday: sameDay ? sim.sentToday + 1 : 1,
      sentTodayDate: now,
    },
  });
}

export function startSmsWorker() {
  const worker = new Worker<SmsJobPayload>(
    QUEUE_SMS,
    async (job, token) => {
      const data = job.data;
      const recipient = await prisma.campaignRecipient.findUnique({ where: { id: data.recipientId } });
      if (!recipient) return { skipped: "missing" };
      if (recipient.status === "SENT" || recipient.status === "DELIVERED" || recipient.status === "CANCELLED") {
        return { skipped: recipient.status };
      }

      const campaign = await prisma.campaign.findUnique({ where: { id: data.campaignId } });
      if (!campaign || campaign.status === "CANCELLED") {
        await prisma.campaignRecipient.update({
          where: { id: data.recipientId },
          data: { status: "CANCELLED" },
        });
        return { skipped: "CANCELLED" };
      }
      if (campaign.status === "PAUSED") {
        await job.moveToDelayed(Date.now() + 120_000, token);
        throw new DelayedError();
      }

      if (await isPhoneUnsubscribed(data.phoneNumber)) {
        await prisma.campaignRecipient.update({
          where: { id: data.recipientId },
          data: { status: "FAILED", errorCode: "UNSUBSCRIBED" },
        });
        await maybeCompleteCampaign(data.campaignId);
        return { skipped: "UNSUBSCRIBED" };
      }

      const sims = await getOnlineSelectableSims();
      const selection = selectSimLine(sims, {
        preferredDevice: data.preferredDevice,
        preferredSim: data.preferredSim,
      });

      if (!selection.ok) {
        await prisma.campaignRecipient.update({
          where: { id: data.recipientId },
          data: { status: "QUEUED", errorCode: selection.error },
        });
        if (selection.error === "DEVICE_OFFLINE") {
          // Leave the row QUEUED in Postgres. Do not bounce Redis every 15s.
          return { skipped: "DEVICE_OFFLINE" };
        }
        if (selection.error === "RATE_LIMIT") {
          await job.moveToDelayed(Date.now() + 60_000, token);
          throw new DelayedError();
        }
        if (!shouldRetry(selection.error, job.attemptsMade + 1, config.smsJobAttempts)) {
          await prisma.campaignRecipient.update({
            where: { id: data.recipientId },
            data: { status: "FAILED", errorCode: selection.error },
          });
          await maybeCompleteCampaign(data.campaignId);
          return { failed: selection.error };
        }
        await job.moveToDelayed(Date.now() + 60_000, token);
        throw new DelayedError();
      }

      const sim = selection.sim;

      await prisma.campaignRecipient.update({
        where: { id: data.recipientId },
        data: {
          status: "SENDING",
          deviceDbId: sim.deviceDbId,
          simLineId: sim.id,
          attempts: { increment: 1 },
        },
      });

      try {
        const ok = await sendJobToDevice(sim.deviceId, { ...data, simSlot: sim.slot });
        if (!ok) {
          const latest = await prisma.campaignRecipient.findUnique({ where: { id: data.recipientId } });
          if (latest?.status === "SENT" || latest?.status === "DELIVERED") {
            return { dispatched: true };
          }
          const code = latest?.errorCode ?? "SMS_FAILED";
          if (shouldRetry(code, latest?.attempts ?? job.attemptsMade + 1, config.smsJobAttempts)) {
            await prisma.campaignRecipient.updateMany({
              where: { id: data.recipientId, status: { in: ["FAILED", "SENDING"] } },
              data: { status: "QUEUED" },
            });
            await job.moveToDelayed(Date.now() + 60_000, token);
            throw new DelayedError();
          }
          await maybeCompleteCampaign(data.campaignId);
          return { failed: true };
        }
        return { dispatched: true };
      } catch (err) {
        if (err instanceof DelayedError) throw err;
        removePendingJob(data.recipientId);
        const code = (err as { code?: string }).code === "DEVICE_OFFLINE" ? "DEVICE_OFFLINE" : "SMS_FAILED";
        logger.warn({ err, recipientId: data.recipientId }, "dispatch failed");
        await prisma.campaignRecipient.updateMany({
          where: { id: data.recipientId, status: { in: ["SENDING", "QUEUED"] } },
          data: { status: "QUEUED", errorCode: code, errorDetail: (err as Error).message?.slice(0, 180) },
        });
        if (code === "DEVICE_OFFLINE") return { skipped: "DEVICE_OFFLINE" };
        const latest = await prisma.campaignRecipient.findUnique({ where: { id: data.recipientId } });
        if (shouldRetry(code, latest?.attempts ?? job.attemptsMade + 1, config.smsJobAttempts)) {
          await job.moveToDelayed(Date.now() + 60_000, token);
          throw new DelayedError();
        }
        throw err;
      }
    },
    {
      connection: getRedis(),
      concurrency: 1,
      lockDuration: 120_000,
      stalledInterval: 120_000,
      maxStalledCount: 1,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "sms job failed");
  });

  return worker;
}

export { markSimUsed };
