import { prisma } from "../utils/prisma.js";
import { interpolateMessage, estimateCampaignSms } from "../utils/template.js";
import { excludeUnsubscribed } from "../utils/unsubscribe.js";
import { canTransition, type CampaignLifecycle } from "../utils/campaign.js";
import { getUnsubscribedSet } from "./unsubscribeService.js";
import { enqueueSmsJobs, removeQueuedJobsForCampaign } from "../queues/smsQueue.js";
import { createContact, importCsv } from "./contactService.js";

export async function listCampaigns() {
  const [rows, groups] = await Promise.all([
    prisma.campaign.findMany({
      include: {
        list: { include: { _count: { select: { members: true } } } },
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.campaignRecipient.groupBy({
      by: ["campaignId", "status"],
      _count: { _all: true },
    }),
  ]);
  const statsByCampaign = new Map<string, { sent: number; failed: number; queued: number; delivered: number }>();
  for (const g of groups) {
    const cur = statsByCampaign.get(g.campaignId) ?? { sent: 0, failed: 0, queued: 0, delivered: 0 };
    if (g.status === "SENT" || g.status === "DELIVERED") cur.sent += g._count._all;
    if (g.status === "DELIVERED") cur.delivered = g._count._all;
    else if (g.status === "FAILED") cur.failed = g._count._all;
    else if (g.status === "QUEUED" || g.status === "SENDING") cur.queued += g._count._all;
    statsByCampaign.set(g.campaignId, cur);
  }
  return rows.map((c) => ({
    ...c,
    contactsCount: c.list?._count.members ?? 0,
    stats: statsByCampaign.get(c.id) ?? { sent: 0, failed: 0, queued: 0, delivered: 0 },
  }));
}

export async function getCampaign(id: string) {
  return prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: {
      list: {
        include: {
          members: {
            include: { contact: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
      recipients: {
        include: { simLine: true, contact: true },
        orderBy: { createdAt: "desc" },
        take: 400,
      },
    },
  });
}

export async function ensureCampaignList(campaignId: string): Promise<string> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.listId) return campaign.listId;
  const list = await prisma.contactList.create({ data: { name: campaign.name } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { listId: list.id } });
  return list.id;
}

export async function addCampaignContact(campaignId: string, input: unknown) {
  const listId = await ensureCampaignList(campaignId);
  return createContact({ ...(input as object), listId });
}

export async function importCampaignContacts(campaignId: string, csv: string) {
  const listId = await ensureCampaignList(campaignId);
  return importCsv(csv, listId);
}

export async function removeCampaignContact(campaignId: string, contactId: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (!campaign.listId) return;
  await prisma.contactListMember.deleteMany({
    where: { listId: campaign.listId, contactId },
  });
}

export async function createCampaign(input: {
  name: string;
  message: string;
  listId?: string;
  scheduledAt?: string;
  preferredSimSlot?: number | null;
}) {
  if (!input.name?.trim() || !input.message?.trim()) {
    throw Object.assign(new Error("Nom et message requis"), { status: 400 });
  }
  const list = input.listId
    ? await prisma.contactList.findUnique({ where: { id: input.listId } })
    : await prisma.contactList.create({ data: { name: input.name.trim() } });
  if (!list) {
    throw Object.assign(new Error("Liste introuvable"), { status: 400 });
  }
  const slot = input.preferredSimSlot === 1 || input.preferredSimSlot === 2 ? input.preferredSimSlot : null;
  return prisma.campaign.create({
    data: {
      name: input.name.trim(),
      message: input.message,
      listId: list.id,
      preferredSimSlot: slot,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });
}

export async function previewCampaign(id: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: {
      list: { include: { members: { include: { contact: true } } } },
    },
  });

  const contacts = campaign.list
    ? campaign.list.members.map((m) => m.contact)
    : await prisma.contact.findMany();

  const unsub = await getUnsubscribedSet(contacts.map((c) => c.telephone));
  const { kept, excluded } = excludeUnsubscribed(contacts, unsub);
  const estimate = estimateCampaignSms(campaign.message, kept);
  const sample = kept[0]
    ? interpolateMessage(campaign.message, kept[0])
    : interpolateMessage(campaign.message, { prenom: "Jean", nom: "Dupont", telephone: "+33600000000" });

  return {
    campaign,
    recipients: kept.length,
    unsubscribed: excluded.length,
    estimate,
    preview: sample,
  };
}

async function transition(id: string, to: CampaignLifecycle) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  if (!canTransition(campaign.status, to)) {
    throw Object.assign(new Error(`Transition ${campaign.status} → ${to} interdite`), { status: 409 });
  }
  return campaign;
}

export async function startCampaign(id: string, opts: { preferredSimSlot?: number | null } = {}) {
  const current = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const slot =
    opts.preferredSimSlot === 1 || opts.preferredSimSlot === 2
      ? opts.preferredSimSlot
      : opts.preferredSimSlot === 0
        ? null
        : current.preferredSimSlot;
  if (slot !== current.preferredSimSlot) {
    await prisma.campaign.update({ where: { id }, data: { preferredSimSlot: slot } });
  }
  const pending = await prisma.campaignRecipient.count({
    where: { campaignId: id, status: { in: ["QUEUED", "SENDING"] } },
  });
  if (!(current.status === "RUNNING" && pending === 0)) {
    await transition(id, "RUNNING");
  }

  const queued = await prisma.$transaction(async (tx) => {
    await tx.campaignRecipient.deleteMany({
      where: { campaignId: id, status: { in: ["QUEUED", "FAILED"] } },
    });

    const contacts = current.listId
      ? (
          await tx.contactList.findUniqueOrThrow({
            where: { id: current.listId },
            include: { members: { include: { contact: true } } },
          })
        ).members.map((m) => m.contact)
      : await tx.contact.findMany();

    const unsubRows = await tx.unsubscribe.findMany({
      where: { telephone: { in: contacts.map((c) => c.telephone) } },
      select: { telephone: true },
    });
    const { kept } = excludeUnsubscribed(contacts, new Set(unsubRows.map((u) => u.telephone)));
    const alreadySent = await tx.campaignRecipient.findMany({
      where: { campaignId: id, status: { in: ["SENT", "DELIVERED"] } },
      select: { phoneNumber: true },
    });
    const sentSet = new Set(alreadySent.map((r) => r.phoneNumber));
    const toQueue = kept.filter((c) => !sentSet.has(c.telephone));

    if (toQueue.length === 0) {
      await tx.campaign.update({
        where: { id },
        data: { status: current.status === "COMPLETED" ? "COMPLETED" : "DRAFT", startedAt: null },
      });
      return { empty: true as const, contactCount: contacts.length, recipients: [] };
    }

    await tx.campaignRecipient.createMany({
      data: toQueue.map((c) => ({
        campaignId: id,
        contactId: c.id,
        phoneNumber: c.telephone,
        message: interpolateMessage(current.message, c),
        status: "QUEUED" as const,
      })),
    });

    await tx.campaign.update({
      where: { id },
      data: { status: "RUNNING", startedAt: current.startedAt ?? new Date() },
    });

    return {
      empty: false as const,
      contactCount: contacts.length,
      recipients: await tx.campaignRecipient.findMany({ where: { campaignId: id, status: "QUEUED" } }),
    };
  });

  if (queued.empty) {
    throw Object.assign(
      new Error(
        queued.contactCount === 0
          ? "Aucun contact dans la liste. Ajoute ton numéro dans Contacts (coche la liste Offre Boxing Center), puis relance."
          : "Tous les contacts de cette liste ont déjà reçu le SMS, ou sont désinscrits.",
      ),
      { status: 400 },
    );
  }

  await enqueueSmsJobs(
    queued.recipients.map((r) => ({
      recipientId: r.id,
      campaignId: r.campaignId,
      contactId: r.contactId,
      phoneNumber: r.phoneNumber,
      message: r.message,
      preferredSim: slot ?? undefined,
    })),
  );

  return { queued: queued.recipients.length, preferredSimSlot: slot ?? null };
}

export async function retryUnconfirmed(id: string, opts: { preferredSimSlot?: number | null } = {}) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const slot =
    opts.preferredSimSlot === 1 || opts.preferredSimSlot === 2
      ? opts.preferredSimSlot
      : opts.preferredSimSlot === 0
        ? null
        : campaign.preferredSimSlot;
  if (slot !== campaign.preferredSimSlot) {
    await prisma.campaign.update({ where: { id }, data: { preferredSimSlot: slot } });
  }
  if (campaign.status === "PAUSED" || campaign.status === "CANCELLED") {
    await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
  }

  const rows = await prisma.campaignRecipient.findMany({
    where: {
      campaignId: id,
      OR: [{ status: "FAILED" }, { status: "QUEUED" }, { status: "SENDING" }, { status: "SENT", deliveredAt: null }],
    },
  });
  if (!rows.length) {
    throw Object.assign(new Error("Aucun SMS à renvoyer (échecs ou sans accusé de réception)."), { status: 400 });
  }

  await prisma.campaignRecipient.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: "QUEUED", errorCode: null, errorDetail: null, sentAt: null, deliveredAt: null },
  });

  await enqueueSmsJobs(
    rows.map((r) => ({
      recipientId: r.id,
      campaignId: r.campaignId,
      contactId: r.contactId,
      phoneNumber: r.phoneNumber,
      message: r.message,
      preferredSim: slot ?? undefined,
    })),
  );

  return { queued: rows.length, preferredSimSlot: slot ?? null };
}

export async function pauseCampaign(id: string) {
  await transition(id, "PAUSED");
  await prisma.campaign.update({ where: { id }, data: { status: "PAUSED" } });
  return { status: "PAUSED" };
}

export async function resumeCampaign(id: string) {
  await transition(id, "RUNNING");
  await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
  return { status: "RUNNING" };
}

export async function cancelCampaign(id: string) {
  await transition(id, "CANCELLED");
  await prisma.campaign.update({ where: { id }, data: { status: "CANCELLED" } });
  await prisma.campaignRecipient.updateMany({
    where: { campaignId: id, status: { in: ["QUEUED", "SENDING"] } },
    data: { status: "CANCELLED" },
  });
  await removeQueuedJobsForCampaign(id);
  return { status: "CANCELLED" };
}

export async function deleteCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) {
    throw Object.assign(new Error("Campagne introuvable"), { status: 404 });
  }
  await removeQueuedJobsForCampaign(id);
  await prisma.campaign.delete({ where: { id } });
}

export async function campaignStats(id: string) {
  const groups = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId: id },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const sentPhone = (counts.SENT ?? 0) + (counts.DELIVERED ?? 0);
  const delivered = counts.DELIVERED ?? 0;
  const failed = counts.FAILED ?? 0;
  const queued = (counts.QUEUED ?? 0) + (counts.SENDING ?? 0);
  const cancelled = counts.CANCELLED ?? 0;
  const total = sentPhone + failed + queued + cancelled;
  const progress = total === 0 ? 0 : Math.round((sentPhone / total) * 100);
  const receivedPct = sentPhone === 0 ? 0 : Math.round((delivered / sentPhone) * 100);
  return {
    sent: sentPhone,
    delivered,
    failed,
    queued,
    cancelled,
    total,
    progress,
    receivedPct,
  };
}

export async function maybeCompleteCampaign(campaignId: string) {
  const pending = await prisma.campaignRecipient.count({
    where: { campaignId, status: { in: ["QUEUED", "SENDING"] } },
  });
  if (pending === 0) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (campaign?.name === "Messages logiciels") return;
    if (campaign?.status === "RUNNING") {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}

export async function dashboardStats() {
  const [contacts, campaigns, sent, failed, devices, running] = await Promise.all([
    prisma.contact.count(),
    prisma.campaign.count(),
    prisma.campaignRecipient.count({ where: { status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.campaignRecipient.count({ where: { status: "FAILED" } }),
    prisma.device.findMany({ include: { simLines: true } }),
    prisma.campaign.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const online = devices.filter((d) => d.status === "ONLINE").length;
  const current = running ? { campaign: running, stats: await campaignStats(running.id) } : null;
  return {
    contacts,
    campaigns,
    sent,
    failed,
    devices: { total: devices.length, online },
    current,
  };
}
