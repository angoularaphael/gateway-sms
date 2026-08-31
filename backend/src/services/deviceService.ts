import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { generateApiKey, generateDeviceId, hashApiKey } from "./authService.js";
import { config } from "../config.js";

const registerSchema = z.object({
  name: z.string().min(1).optional(),
  appVersion: z.string().optional(),
  sims: z
    .array(
      z.object({
        slot: z.number().int().min(1).max(4),
        phoneNumber: z.string().optional().nullable(),
        status: z.enum(["READY", "ABSENT", "ERROR", "UNKNOWN"]).default("UNKNOWN"),
      }),
    )
    .optional(),
});

async function nextDeviceId(): Promise<string> {
  const devices = await prisma.device.findMany({ select: { deviceId: true } });
  let max = 0;
  for (const d of devices) {
    const match = /^ANDROID-(\d+)$/.exec(d.deviceId);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return generateDeviceId(max + 1);
}

export async function registerDevice(input: unknown) {
  const data = registerSchema.parse(input ?? {});
  const deviceId = await nextDeviceId();
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  const device = await prisma.device.create({
    data: {
      deviceId,
      name: data.name ?? deviceId,
      appVersion: data.appVersion,
      apiKeyHash,
      simCount: data.sims?.length ?? 0,
      simLines: {
        create: (data.sims ?? []).map((s) => ({
          slot: s.slot,
          phoneNumber: s.phoneNumber,
          status: s.status,
          dailyLimit: config.defaultDailyLimit,
          ratePerMinute: config.defaultRatePerMinute,
        })),
      },
    },
    include: { simLines: true },
  });

  return { device, apiKey };
}

export async function authenticateDevice(deviceId: string, apiKey: string) {
  const device = await prisma.device.findUnique({ where: { deviceId }, include: { simLines: true } });
  if (!device) return null;
  const ok = await bcrypt.compare(apiKey, device.apiKeyHash);
  return ok ? device : null;
}

export async function deleteDevice(deviceId: string) {
  const device = await prisma.device.findUnique({ where: { deviceId } });
  if (!device) {
    throw Object.assign(new Error("Appareil introuvable"), { status: 404 });
  }
  const { forgetDevice } = await import("../websocket/gateway.js");
  forgetDevice(deviceId);
  await prisma.device.delete({ where: { id: device.id } });
}

export async function listDevices() {
  const devices = await prisma.device.findMany({
    include: {
      simLines: { orderBy: { slot: "asc" } },
      _count: { select: { recipients: true } },
    },
    orderBy: { deviceId: "asc" },
  });

  const failed = await prisma.campaignRecipient.groupBy({
    by: ["deviceDbId"],
    where: { status: "FAILED" },
    _count: { _all: true },
  });
  const failedMap = new Map(failed.map((f) => [f.deviceDbId, f._count._all]));

  return devices.map((d) => ({
    ...d,
    messagesSent: d._count.recipients,
    errors: failedMap.get(d.id) ?? 0,
  }));
}

export async function heartbeat(
  deviceId: string,
  payload: {
    appVersion?: string;
    sims?: Array<{ slot: number; phoneNumber?: string | null; status: "READY" | "ABSENT" | "ERROR" | "UNKNOWN" }>;
  },
) {
  const device = await prisma.device.findUnique({ where: { deviceId } });
  if (!device) {
    throw Object.assign(new Error("Appareil introuvable"), { status: 404 });
  }

  const sims = payload.sims ?? [];
  await prisma.$transaction(async (tx) => {
    await tx.device.update({
      where: { id: device.id },
      data: {
        status: "ONLINE",
        lastSeenAt: new Date(),
        appVersion: payload.appVersion ?? device.appVersion,
        simCount: sims.length || device.simCount,
      },
    });

    for (const s of sims) {
      await tx.simLine.upsert({
        where: { deviceDbId_slot: { deviceDbId: device.id, slot: s.slot } },
        create: {
          deviceDbId: device.id,
          slot: s.slot,
          phoneNumber: s.phoneNumber,
          status: s.status,
          dailyLimit: config.defaultDailyLimit,
          ratePerMinute: config.defaultRatePerMinute,
        },
        update: {
          phoneNumber: s.phoneNumber ?? undefined,
          status: s.status,
        },
      });
    }
  });

  return prisma.device.findUniqueOrThrow({
    where: { id: device.id },
    include: { simLines: { orderBy: { slot: "asc" } } },
  });
}

export async function markStaleDevicesOffline() {
  const threshold = new Date(Date.now() - config.deviceOfflineAfterSeconds * 1000);
  await prisma.device.updateMany({
    where: {
      status: "ONLINE",
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
    },
    data: { status: "OFFLINE" },
  });
}

export async function updateSimLine(
  id: string,
  data: { dailyLimit?: number; ratePerMinute?: number; enabled?: boolean; phoneNumber?: string },
) {
  if (data.dailyLimit !== undefined && data.dailyLimit < 1) {
    throw Object.assign(new Error("dailyLimit trop bas"), { status: 400 });
  }
  if (data.ratePerMinute !== undefined && data.ratePerMinute < 1) {
    throw Object.assign(new Error("ratePerMinute trop bas"), { status: 400 });
  }
  return prisma.simLine.update({ where: { id }, data });
}

export async function getOnlineSelectableSims() {
  await markStaleDevicesOffline();
  const devices = await prisma.device.findMany({
    include: { simLines: true },
  });
  return devices.flatMap((d) =>
    d.simLines.map((s) => ({
      id: s.id,
      deviceDbId: d.id,
      deviceId: d.deviceId,
      slot: s.slot,
      phoneNumber: s.phoneNumber,
      status: s.status,
      dailyLimit: s.dailyLimit,
      ratePerMinute: s.ratePerMinute,
      enabled: s.enabled,
      lastUsedAt: s.lastUsedAt,
      sentToday: s.sentToday,
      sentTodayDate: s.sentTodayDate,
      deviceOnline: d.status === "ONLINE",
    })),
  );
}
