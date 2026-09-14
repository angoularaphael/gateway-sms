import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Prisma, SmsErrorCode } from "@prisma/client";
import { config } from "../config.js";
import { QUEUE_SMS, isContestConfirmationSms, isContestSms, type SmsJob } from "../utils/campaign.js";
import { logger } from "../utils/logger.js";
import type { SmsJobPayload } from "../types.js";

let connection: IORedis | null = null;
let smsQueue: Queue<SmsJobPayload> | null = null;
let redisLimitHitAt = 0;

export function redisCommandsBlocked(): boolean {
  return redisLimitHitAt > 0 && Date.now() - redisLimitHitAt < 30 * 60_000;
}

function noteRedisError(err: unknown) {
  const msg = String((err as Error)?.message || err || "");
  if (/max requests limit/i.test(msg)) {
    redisLimitHitAt = Date.now();
    logger.error("Upstash: quota Redis mensuel atteint — on arrête les commandes 30 min");
  }
}

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      retryStrategy(times) {
        if (redisCommandsBlocked()) return 60_000;
        return Math.min(2000 * times, 30_000);
      },
    });
    connection.on("error", (err) => {
      noteRedisError(err);
    });
  }
  return connection;
}

export function getSmsQueue(): Queue<SmsJobPayload> {
  if (!smsQueue) {
    smsQueue = new Queue<SmsJobPayload>(QUEUE_SMS, { connection: getRedis() });
  }
  return smsQueue;
}

function isDuplicateJobError(err: unknown): boolean {
  const msg = String((err as Error)?.message || "");
  return /already (exists|exist|in the queue|in queue)/i.test(msg);
}

export async function enqueueSmsJobs(
  jobs: SmsJobPayload[],
  opts: { priority?: number } = {},
): Promise<void> {
  if (jobs.length === 0) return;
  if (redisCommandsBlocked()) return;
  const queue = getSmsQueue();
  for (const data of jobs) {
    try {
      const existing = await queue.getJob(data.recipientId);
      if (existing) {
        try {
          await existing.remove();
        } catch {
          /* job actif : on tentera add, ignoré si déjà en file */
        }
      }
      await queue.add("send-sms", data, {
        attempts: Math.max(config.smsJobAttempts, 1),
        backoff: { type: "exponential", delay: config.smsJobBackoffMs },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
        jobId: data.recipientId,
        ...(opts.priority != null ? { priority: opts.priority } : {}),
      });
    } catch (err) {
      noteRedisError(err);
      if (isDuplicateJobError(err) || redisCommandsBlocked()) continue;
      throw err;
    }
  }
}

export async function requeueQueuedRecipients(): Promise<number> {
  return requeueStuckRecipients({ take: 25, queuedOnly: true });
}

export async function requeueStuckRecipients(
  opts: { take?: number; queuedOnly?: boolean } = {},
): Promise<number> {
  if (redisCommandsBlocked()) return 0;
  const take = Math.max(1, Math.min(opts.take ?? 3, 8));
  const { prisma } = await import("../utils/prisma.js");
  const online = await prisma.device.count({ where: { status: "ONLINE" } });
  if (online === 0) return 0;

  const cancelledConfirm = await prisma.campaignRecipient.updateMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      message: { contains: "est bien confirmée", mode: "insensitive" },
    },
    data: { status: "CANCELLED", errorDetail: "sms_disabled" },
  });
  if (cancelledConfirm.count > 0) {
    logger.info({ n: cancelledConfirm.count }, "SMS confirmation Hexagone MMA annulés");
  }

  const resumed = await prisma.campaign.updateMany({
    where: {
      status: "PAUSED",
      NOT: {
        OR: [
          { name: { startsWith: "Concours SMS" } },
          { name: { startsWith: "Boutique SMS" } },
          { name: "Messages logiciels" },
        ],
      },
    },
    data: { status: "RUNNING", completedAt: null },
  });
  if (resumed.count > 0) {
    logger.info({ n: resumed.count }, "Campagnes offre / hors concours remises en envoi");
  }

  const retryErrors: SmsErrorCode[] = ["SMS_FAILED", "DEVICE_OFFLINE", "RATE_LIMIT", "NO_SIM"];
  const statusWhere: Prisma.CampaignRecipientWhereInput = opts.queuedOnly
    ? { status: "QUEUED" }
    : {
        OR: [
          { status: "QUEUED" },
          { status: "SENDING" },
          {
            status: "FAILED",
            errorCode: { in: retryErrors },
            attempts: { lt: 10 },
          },
        ],
      };

  const contestWhere: Prisma.CampaignRecipientWhereInput = {
    AND: [
      {
        OR: [
          { campaign: { name: { startsWith: "Concours SMS" } } },
          { message: { contains: "jeu concours", mode: "insensitive" } },
          { message: { contains: "10 ans Boxing Center", mode: "insensitive" } },
        ],
      },
      { NOT: { campaign: { name: { startsWith: "Boutique SMS" } } } },
      { NOT: { message: { contains: "est bien confirmée", mode: "insensitive" } } },
    ],
  };

  const activeCampaign: Prisma.CampaignRecipientWhereInput = {
    campaign: { status: { notIn: ["PAUSED", "CANCELLED"] } },
  };

  const contestPending = await prisma.campaignRecipient.count({
    where: { AND: [statusWhere, activeCampaign, contestWhere] },
  });

  const contestTake = contestPending > 0 ? Math.max(1, Math.floor(take / 3)) : 0;
  const restTake = Math.max(1, take - contestTake);

  const contestRows =
    contestTake > 0
      ? await prisma.campaignRecipient.findMany({
          where: { AND: [statusWhere, activeCampaign, contestWhere] },
          include: { campaign: { select: { name: true } } },
          take: contestTake,
          orderBy: { createdAt: "asc" },
        })
      : [];

  const restRows = await prisma.campaignRecipient.findMany({
    where: {
      AND: [
        statusWhere,
        activeCampaign,
        { NOT: contestWhere },
        { NOT: { message: { contains: "est bien confirmée", mode: "insensitive" } } },
        contestRows.length
          ? { id: { notIn: contestRows.map((r) => r.id) } }
          : {},
      ],
    },
    include: { campaign: { select: { name: true } } },
    take: restTake,
    orderBy: { createdAt: "asc" },
  });

  const rows = [...contestRows, ...restRows];
  if (rows.length === 0) return 0;

  const campaignIds = [...new Set(rows.map((r) => r.campaignId))];
  await prisma.campaign.updateMany({
    where: { id: { in: campaignIds }, status: { in: ["COMPLETED", "DRAFT"] } },
    data: { status: "RUNNING", completedAt: null },
  });
  await prisma.campaignRecipient.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: "QUEUED", errorCode: null, errorDetail: null },
  });
  const contestJobs = rows.filter(
    (r) =>
      isContestSms({ campaignName: r.campaign.name, message: r.message }) &&
      !isContestConfirmationSms(r.message),
  );
  const restJobs = rows.filter(
    (r) =>
      !isContestSms({ campaignName: r.campaign.name, message: r.message }) &&
      !isContestConfirmationSms(r.message),
  );
  await enqueueSmsJobs(
    contestJobs.map((r) => ({
      recipientId: r.id,
      campaignId: r.campaignId,
      contactId: r.contactId,
      phoneNumber: r.phoneNumber,
      message: r.message,
    })),
    { priority: 1 },
  );
  await enqueueSmsJobs(
    restJobs.map((r) => ({
      recipientId: r.id,
      campaignId: r.campaignId,
      contactId: r.contactId,
      phoneNumber: r.phoneNumber,
      message: r.message,
    })),
    { priority: 10 },
  );
  return rows.length;
}

export async function removeQueuedJobsForCampaign(campaignId: string): Promise<void> {
  if (redisCommandsBlocked()) return;
  const queue = getSmsQueue();
  const jobs = await queue.getJobs(["waiting", "delayed", "paused"]);
  await Promise.all(jobs.filter((j) => j.data.campaignId === campaignId).map((j) => j.remove()));
}

export async function pauseSmsQueue(): Promise<void> {
  await getSmsQueue().pause();
}

export async function resumeSmsQueue(): Promise<void> {
  await getSmsQueue().resume();
}

export type { SmsJob };
