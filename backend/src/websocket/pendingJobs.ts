import type { SmsJobPayload } from "../types.js";

export type PendingSmsJob = SmsJobPayload & { simSlot: number };

const queues = new Map<string, PendingSmsJob[]>();

export function enqueuePendingJob(deviceId: string, job: PendingSmsJob): void {
  const queued = queues.get(deviceId) ?? [];
  if (!queued.some((item) => item.recipientId === job.recipientId)) {
    queued.push(job);
    queues.set(deviceId, queued);
  }
}

/** Returns jobs without removing them. Removed only after the phone ACKs. */
export function peekPendingJobs(deviceId: string, limit = 1): PendingSmsJob[] {
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 1;
  return (queues.get(deviceId) ?? []).slice(0, n);
}

export function removePendingJob(recipientId: string): void {
  for (const [deviceId, jobs] of queues) {
    const next = jobs.filter((j) => j.recipientId !== recipientId);
    if (next.length === 0) queues.delete(deviceId);
    else queues.set(deviceId, next);
  }
}

export function clearDevicePending(deviceId: string): void {
  queues.delete(deviceId);
}

export function resetPendingJobsForTests(): void {
  queues.clear();
}
