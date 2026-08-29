import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { authenticateDevice } from "../services/deviceService.js";
import { logger } from "../utils/logger.js";
import type { SmsJobPayload } from "../types.js";

type DeviceSocket = WebSocket & { deviceId?: string };

const sockets = new Map<string, DeviceSocket>();
const pending = new Map<
  string,
  { resolve: (ok: boolean) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }
>();

const httpPending = new Map<string, Array<SmsJobPayload & { simSlot: number }>>();

export function attachGatewaySocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws/gateway" });

  wss.on("connection", async (ws: DeviceSocket, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const deviceId = url.searchParams.get("deviceId") ?? "";
    const apiKey = url.searchParams.get("apiKey") ?? "";
    const device = await authenticateDevice(deviceId, apiKey);
    if (!device) {
      ws.close(4401, "unauthorized");
      return;
    }
    ws.deviceId = device.deviceId;
    sockets.set(device.deviceId, ws);
    logger.info({ deviceId: device.deviceId }, "gateway websocket connected");

    ws.on("close", () => {
      if (sockets.get(device.deviceId) === ws) sockets.delete(device.deviceId);
    });
  });

  return wss;
}

export function isDeviceConnected(deviceId: string): boolean {
  const ws = sockets.get(deviceId);
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

export function sendJobToDevice(deviceId: string, job: SmsJobPayload & { simSlot: number }): Promise<boolean> {
  const queued = httpPending.get(deviceId) ?? [];
  queued.push(job);
  httpPending.set(deviceId, queued);

  const ws = sockets.get(deviceId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "sms.job", job }));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(job.recipientId);
      reject(Object.assign(new Error("DEVICE_OFFLINE"), { code: "DEVICE_OFFLINE" }));
    }, 45_000);
    pending.set(job.recipientId, { resolve, reject, timeout });
  });
}

export function resolveJobAck(recipientId: string, ok: boolean) {
  const waiter = pending.get(recipientId);
  if (!waiter) return;
  clearTimeout(waiter.timeout);
  pending.delete(recipientId);
  waiter.resolve(ok);
}

export function pullPendingJobs(deviceId: string) {
  const jobs = httpPending.get(deviceId) ?? [];
  httpPending.set(deviceId, []);
  return jobs;
}
