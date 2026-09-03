import type { Request, Response } from "express";
import * as authService from "../services/authService.js";
import * as contactService from "../services/contactService.js";
import * as unsubscribeService from "../services/unsubscribeService.js";
import * as deviceService from "../services/deviceService.js";
import * as campaignService from "../services/campaignService.js";
import * as outboundService from "../services/outboundService.js";
import { prisma } from "../utils/prisma.js";
import { markSimUsed } from "../workers/smsWorker.js";
import { maybeCompleteCampaign } from "../services/campaignService.js";
import { resolveJobAck } from "../websocket/gateway.js";
import { planSmsResult } from "../utils/smsResult.js";

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

export const auth = {
  login: asyncHandler(async (req, res) => {
    const result = await authService.login(req.body.email, req.body.password);
    res.json(result);
  }),
  me: asyncHandler(async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    res.json(user);
  }),
};

export const contacts = {
  list: asyncHandler(async (req, res) => {
    const result = await contactService.listContacts({
      search: String(req.query.search ?? "") || undefined,
      skip: Number(req.query.skip ?? 0),
      take: Number(req.query.take ?? 50),
    });
    res.json(result);
  }),
  create: asyncHandler(async (req, res) => {
    res.status(201).json(await contactService.createContact(req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    await contactService.deleteContact(String(req.params.id));
    res.status(204).end();
  }),
  importCsv: asyncHandler(async (req, res) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    const content = file ? file.buffer.toString("utf8") : String(req.body.csv ?? "");
    res.json(await contactService.importCsv(content, req.body.listId));
  }),
  exportCsv: asyncHandler(async (req, res) => {
    const { items } = await contactService.listContacts({ take: 10_000 });
    const csv = contactService.exportContactsCsv(items);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
    res.send(csv);
  }),
  lists: asyncHandler(async (_req, res) => {
    res.json(await contactService.listContactLists());
  }),
  createList: asyncHandler(async (req, res) => {
    res.status(201).json(await contactService.createContactList(String(req.body.name ?? "")));
  }),
  removeList: asyncHandler(async (req, res) => {
    await contactService.deleteContactList(String(req.params.id));
    res.status(204).end();
  }),
  addToList: asyncHandler(async (req, res) => {
    res.json(await contactService.addContactsToList(String(req.params.id), req.body.contactIds ?? []));
  }),
};

export const unsubscribes = {
  create: asyncHandler(async (req, res) => {
    res.status(201).json(await unsubscribeService.unsubscribe(req.body));
  }),
  list: asyncHandler(async (_req, res) => {
    res.json(await unsubscribeService.listUnsubscribes());
  }),
};

export const devices = {
  list: asyncHandler(async (_req, res) => {
    res.json(await deviceService.listDevices());
  }),
  register: asyncHandler(async (req, res) => {
    res.status(201).json(await deviceService.registerDevice(req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    await deviceService.deleteDevice(String(req.params.id));
    res.status(204).end();
  }),
  heartbeat: asyncHandler(async (req, res) => {
    res.json(await deviceService.heartbeat(String(req.params.id), req.body ?? {}));
  }),
  updateSim: asyncHandler(async (req, res) => {
    res.json(await deviceService.updateSimLine(String(req.params.simId), req.body));
  }),
  smsResult: asyncHandler(async (req, res) => {
    const { recipientId, success, errorCode, errorDetail, stage } = req.body as {
      recipientId: string;
      success: boolean;
      errorCode?: "NO_SIM" | "DEVICE_OFFLINE" | "SMS_FAILED" | "RATE_LIMIT" | "INVALID_NUMBER" | "UNSUBSCRIBED";
      errorDetail?: string;
      stage?: "sent" | "delivered";
    };
    const recipient = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } });
    if (!recipient) {
      res.status(404).json({ error: "Destinataire introuvable" });
      return;
    }
    const kind = stage === "delivered" ? "delivered" : "sent";
    const plan = planSmsResult({
      currentStatus: recipient.status,
      success,
      stage: kind,
      errorCode: errorCode ?? null,
      errorDetail: errorDetail ?? null,
      sentAt: recipient.sentAt,
    });
    if (plan.update) {
      await prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: plan.update.status,
          sentAt: plan.update.sentAt ?? undefined,
          deliveredAt: plan.update.deliveredAt ?? undefined,
          errorCode: plan.update.errorCode,
          errorDetail: plan.update.errorDetail,
        },
      });
      if (plan.update.markSimUsed && recipient.simLineId) {
        await markSimUsed(recipient.simLineId, new Date());
      }
    }
    if (plan.ack !== null) resolveJobAck(recipientId, plan.ack);
    await maybeCompleteCampaign(recipient.campaignId);
    res.json({ ok: true });
  }),
  incomingSms: asyncHandler(async (req, res) => {
    const { from, body } = req.body as { from: string; body: string };
    const { isUnsubscribeKeyword } = await import("../utils/phone.js");
    if (from && body && isUnsubscribeKeyword(body)) {
      await unsubscribeService.unsubscribe({ telephone: from, reason: "SMS keyword" });
    }
    res.json({ ok: true });
  }),
  pendingSms: asyncHandler(async (req, res) => {
    const device = (req as Request & { device: { deviceId: string } }).device;
    const { pullPendingJobs } = await import("../websocket/gateway.js");
    res.json({ jobs: pullPendingJobs(device.deviceId) });
  }),
};

export const campaigns = {
  list: asyncHandler(async (_req, res) => {
    res.json(await campaignService.listCampaigns());
  }),
  get: asyncHandler(async (req, res) => {
    res.json(await campaignService.getCampaign(String(req.params.id)));
  }),
  create: asyncHandler(async (req, res) => {
    res.status(201).json(await campaignService.createCampaign(req.body));
  }),
  addContact: asyncHandler(async (req, res) => {
    res.status(201).json(await campaignService.addCampaignContact(String(req.params.id), req.body));
  }),
  importCsv: asyncHandler(async (req, res) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    const content = file ? file.buffer.toString("utf8") : String(req.body.csv ?? "");
    res.json(await campaignService.importCampaignContacts(String(req.params.id), content));
  }),
  removeContact: asyncHandler(async (req, res) => {
    await campaignService.removeCampaignContact(String(req.params.id), String(req.params.contactId));
    res.status(204).end();
  }),
  preview: asyncHandler(async (req, res) => {
    res.json(await campaignService.previewCampaign(String(req.params.id)));
  }),
  start: asyncHandler(async (req, res) => {
    const slot = req.body?.preferredSimSlot ?? req.body?.simSlot;
    res.json(
      await campaignService.startCampaign(String(req.params.id), {
        preferredSimSlot: slot === undefined ? undefined : slot === null || slot === "" ? 0 : Number(slot),
      }),
    );
  }),
  retry: asyncHandler(async (req, res) => {
    const slot = req.body?.preferredSimSlot ?? req.body?.simSlot;
    res.json(
      await campaignService.retryUnconfirmed(String(req.params.id), {
        preferredSimSlot: slot === undefined ? undefined : slot === null || slot === "" ? 0 : Number(slot),
        contestOnly: Boolean(req.body?.contestOnly),
        pendingOnly: Boolean(req.body?.pendingOnly),
      }),
    );
  }),
  pause: asyncHandler(async (req, res) => {
    res.json(await campaignService.pauseCampaign(String(req.params.id)));
  }),
  resume: asyncHandler(async (req, res) => {
    res.json(await campaignService.resumeCampaign(String(req.params.id)));
  }),
  cancel: asyncHandler(async (req, res) => {
    res.json(await campaignService.cancelCampaign(String(req.params.id)));
  }),
  remove: asyncHandler(async (req, res) => {
    await campaignService.deleteCampaign(String(req.params.id));
    res.status(204).end();
  }),
  stats: asyncHandler(async (req, res) => {
    res.json(await campaignService.campaignStats(String(req.params.id)));
  }),
};

export const dashboard = {
  stats: asyncHandler(async (_req, res) => {
    res.json(await campaignService.dashboardStats());
  }),
};

export const ops = {
  requeue: asyncHandler(async (req, res) => {
    const take = Math.min(Math.max(Number(req.body?.take) || 3, 1), 8);
    const { requeueStuckRecipients } = await import("../queues/smsQueue.js");
    const n = await requeueStuckRecipients({ take });
    res.json({ ok: true, requeued: n });
  }),
};

export const outbound = {
  send: asyncHandler(async (req, res) => {
    const telephone = String(req.body.telephone || req.body.phone || "");
    const message = String(req.body.message || req.body.body || req.body.text || "");
    res.status(202).json(
      await outboundService.sendDirectMessage({
        telephone,
        message,
        prenom: req.body.prenom ? String(req.body.prenom) : undefined,
        nom: req.body.nom ? String(req.body.nom) : undefined,
        source: req.body.source ? String(req.body.source) : undefined,
        simSlot: req.body.simSlot != null ? Number(req.body.simSlot) : undefined,
      }),
    );
  }),
};
