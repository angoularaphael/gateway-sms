import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Prisma, SmsErrorCode } from "@prisma/client";
import { config } from "../config.js";
import { QUEUE_SMS, isOffreDuoReferralSms, isSeanceOfferteSms, type SmsJob } from "../utils/campaign.js";
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

  const cancelledHexagone = await prisma.campaignRecipient.updateMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      OR: [
        { campaign: { name: { startsWith: "Concours SMS" } } },
        { message: { contains: "Hexagone", mode: "insensitive" } },
        { message: { contains: "jeu concours", mode: "insensitive" } },
        { message: { contains: "10 ans Boxing Center", mode: "insensitive" } },
        { message: { contains: "est bien confirmée", mode: "insensitive" } },
      ],
    },
    data: { status: "CANCELLED", errorDetail: "hexagone_sms_disabled" },
  });
  if (cancelledHexagone.count > 0) {
    logger.info({ n: cancelledHexagone.count }, "SMS Hexagone / concours annulés");
  }

  const cancelledOther = await prisma.campaignRecipient.updateMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      campaign: { name: { startsWith: "Boutique SMS" } },
      NOT: {
        OR: [
          { campaign: { name: { contains: "offre-duo-ami" } } },
          { message: { contains: "Offre Duo", mode: "insensitive" } },
        ],
      },
    },
    data: { status: "CANCELLED", errorDetail: "sms_not_allowed" },
  });
  if (cancelledOther.count > 0) {
    logger.info({ n: cancelledOther.count }, "SMS boutique hors offre duo annulés");
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

  const seanceWhere: Prisma.CampaignRecipientWhereInput = {
    OR: [
      { campaign: { name: { contains: "seance-offerte" } } },
      { message: { contains: "seance-offerte.boxingcenter.fr", mode: "insensitive" } },
      { message: { contains: "seance d'essai", mode: "insensitive" } },
    ],
  };

  const activeCampaign: Prisma.CampaignRecipientWhereInput = {
    campaign: { status: { notIn: ["PAUSED", "CANCELLED"] } },
  };

  const duoWhere: Prisma.CampaignRecipientWhereInput = {
    OR: [
      { campaign: { name: { contains: "offre-duo-ami" } } },
      {
        AND: [
          { message: { contains: "Offre Duo", mode: "insensitive" } },
          {
            OR: [
              { message: { contains: "Grace", mode: "insensitive" } },
              { message: { contains: "Grâce", mode: "insensitive" } },
            ],
          },
        ],
      },
    ],
  };

  const restRows = await prisma.campaignRecipient.findMany({
    where: {
      AND: [
        statusWhere,
        activeCampaign,
        { OR: [duoWhere, seanceWhere] },
      ],
    },
    include: { campaign: { select: { name: true } } },
    take,
    orderBy: { createdAt: "asc" },
  });

  const rows = restRows;
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
  const allowedJobs = rows.filter(
    (r) =>
      isOffreDuoReferralSms(r.message) ||
      /offre-duo-ami/i.test(r.campaign.name) ||
      isSeanceOfferteSms({ campaignName: r.campaign.name, message: r.message }),
  );
  await enqueueSmsJobs(
    allowedJobs.map((r) => ({
      recipientId: r.id,
      campaignId: r.campaignId,
      contactId: r.contactId,
      phoneNumber: r.phoneNumber,
      message: r.message,
    })),
    { priority: 1 },
  );
  return allowedJobs.length;
}

const JOB_STATES = ["waiting", "delayed", "paused", "active", "prioritized"] as const;

export async function removeQueuedJobsForCampaign(campaignId: string): Promise<void> {
  if (redisCommandsBlocked()) return;
  const queue = getSmsQueue();
  const jobs = await queue.getJobs([...JOB_STATES], 0, 50_000);
  await Promise.all(
    jobs.filter((j) => j.data.campaignId === campaignId).map((j) => j.remove().catch(() => undefined)),
  );
}

/** Coupe file Redis + destinataires Sport2000 / seance offerte encore en attente (ancien texte). */
export async function purgeSport2000Pending(): Promise<{
  recipientsCancelled: number;
  jobsRemoved: number;
}> {
  if (redisCommandsBlocked()) {
    return { recipientsCancelled: 0, jobsRemoved: 0 };
  }
  const { prisma } = await import("../utils/prisma.js");
  const cancelled = await prisma.campaignRecipient.updateMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      OR: [
        { campaign: { name: { contains: "Sport2000", mode: "insensitive" } } },
        { campaign: { name: { contains: "seance offerte", mode: "insensitive" } } },
        { message: { contains: "seance-offerte.boxingcenter.fr", mode: "insensitive" } },
      ],
    },
    data: { status: "CANCELLED", errorDetail: "purge_sport2000_pending" },
  });

  const queue = getSmsQueue();
  const jobs = await queue.getJobs([...JOB_STATES], 0, 50_000);
  let jobsRemoved = 0;
  for (const job of jobs) {
    const msg = String(job.data?.message || "");
    const name = String((job.data as { campaignName?: string })?.campaignName || "");
    const isSport =
      /sport2000|seance offerte/i.test(name) ||
      /seance-offerte\.boxingcenter\.fr/i.test(msg);
    if (!isSport) continue;
    await job.remove().catch(() => undefined);
    jobsRemoved += 1;
  }
  logger.info({ recipientsCancelled: cancelled.count, jobsRemoved }, "purge Sport2000 pending");
  return { recipientsCancelled: cancelled.count, jobsRemoved };
}

export async function pauseSmsQueue(): Promise<void> {
  await getSmsQueue().pause();
}

export async function resumeSmsQueue(): Promise<void> {
  await getSmsQueue().resume();
}

export type { SmsJob };
