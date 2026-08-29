import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";
import { QUEUE_SMS, type SmsJob } from "../utils/campaign.js";
import type { SmsJobPayload } from "../types.js";

let connection: IORedis | null = null;
let smsQueue: Queue<SmsJobPayload> | null = null;

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getSmsQueue(): Queue<SmsJobPayload> {
  if (!smsQueue) {
    smsQueue = new Queue<SmsJobPayload>(QUEUE_SMS, { connection: getRedis() });
  }
  return smsQueue;
}

export async function enqueueSmsJobs(jobs: SmsJobPayload[]): Promise<void> {
  if (jobs.length === 0) return;
  const queue = getSmsQueue();
  await queue.addBulk(
    jobs.map((data) => ({
      name: "send-sms",
      data,
      opts: {
        attempts: config.smsJobAttempts,
        backoff: { type: "exponential" as const, delay: config.smsJobBackoffMs },
        removeOnComplete: 1000,
        removeOnFail: 5000,
        jobId: data.recipientId,
      },
    })),
  );
}

export async function removeQueuedJobsForCampaign(campaignId: string): Promise<void> {
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
