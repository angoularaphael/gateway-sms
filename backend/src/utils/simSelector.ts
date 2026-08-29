import type { SelectableSim } from "../types.js";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function sentTodayCount(sim: Pick<SelectableSim, "sentToday" | "sentTodayDate">, now: Date): number {
  if (!sim.sentTodayDate) return 0;
  if (startOfUtcDay(sim.sentTodayDate).getTime() !== startOfUtcDay(now).getTime()) {
    return 0;
  }
  return sim.sentToday;
}

export function isWithinRateLimit(sim: SelectableSim, now: Date): { ok: boolean; reason?: "RATE_LIMIT" } {
  const today = sentTodayCount(sim, now);
  if (today >= sim.dailyLimit) {
    return { ok: false, reason: "RATE_LIMIT" };
  }
  if (sim.lastUsedAt) {
    const minIntervalMs = Math.ceil(60_000 / Math.max(sim.ratePerMinute, 1));
    if (now.getTime() - sim.lastUsedAt.getTime() < minIntervalMs) {
      return { ok: false, reason: "RATE_LIMIT" };
    }
  }
  return { ok: true };
}

export type SimSelection =
  | { ok: true; sim: SelectableSim }
  | { ok: false; error: "NO_SIM" | "DEVICE_OFFLINE" | "RATE_LIMIT" };

export function selectSimLine(
  sims: SelectableSim[],
  options: { preferredDevice?: string; preferredSim?: number; now?: Date } = {},
): SimSelection {
  const now = options.now ?? new Date();
  const online = sims.filter((s) => s.deviceOnline && s.enabled && s.status === "READY");

  if (sims.length > 0 && online.length === 0) {
    const anyEnabled = sims.some((s) => s.enabled);
    return { ok: false, error: anyEnabled ? "DEVICE_OFFLINE" : "NO_SIM" };
  }

  if (online.length === 0) {
    return { ok: false, error: "NO_SIM" };
  }

  let candidates = online;
  if (options.preferredDevice) {
    const preferred = candidates.filter((s) => s.deviceId === options.preferredDevice);
    if (preferred.length > 0) candidates = preferred;
  }
  if (options.preferredSim !== undefined) {
    const preferredSlot = candidates.filter((s) => s.slot === options.preferredSim);
    if (preferredSlot.length > 0) candidates = preferredSlot;
  }

  const available = candidates.filter((s) => isWithinRateLimit(s, now).ok);
  if (available.length === 0) {
    return { ok: false, error: "RATE_LIMIT" };
  }

  available.sort((a, b) => {
    const aTime = a.lastUsedAt?.getTime() ?? 0;
    const bTime = b.lastUsedAt?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.slot - b.slot;
  });

  return { ok: true, sim: available[0]! };
}
