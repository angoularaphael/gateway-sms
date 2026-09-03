import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Prisma, SmsErrorCode } from "@prisma/client";
import { config } from "../config.js";
import { QUEUE_SMS, isContestSms, type SmsJob } from "../utils/campaign.js";
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

  const contestPending = await prisma.campaignRecipient.count({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      OR: [
        { campaign: { name: { startsWith: "Concours SMS" } } },
        { message: { contains: "jeu concours", mode: "insensitive" } },
        { message: { contains: "10 ans Boxing Center", mode: "insensitive" } },
      ],
      NOT: { campaign: { name: { startsWith: "Boutique SMS" } } },
    },
  });

  if (contestPending === 0) {
    await prisma.campaign.updateMany({
      where: { name: { startsWith: "Boutique SMS" }, status: "PAUSED" },
      data: { status: "RUNNING", completedAt: null },
    });
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
    OR: [
      { campaign: { name: { startsWith: "Concours SMS" } } },
      { message: { contains: "jeu concours", mode: "insensitive" } },
      { message: { contains: "10 ans Boxing Center", mode: "insensitive" } },
    ],
    NOT: { campaign: { name: { startsWith: "Boutique SMS" } } },
  };

  const rows = await prisma.campaignRecipient.findMany({
    where: {
      AND: [
        statusWhere,
        { campaign: { status: { notIn: ["PAUSED", "CANCELLED"] } } },
        contestPending > 0 ? contestWhere : {},
      ],
    },
    include: { campaign: { select: { name: true } } },
    take,
    orderBy: { createdAt: "asc" },
  });
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
  const contestJobs = rows.filter((r) => isContestSms({ campaignName: r.campaign.name, message: r.message }));
  const restJobs = rows.filter((r) => !isContestSms({ campaignName: r.campaign.name, message: r.message }));
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
