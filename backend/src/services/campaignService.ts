import { prisma } from "../utils/prisma.js";
import { interpolateMessage, estimateCampaignSms } from "../utils/template.js";
import { excludeUnsubscribed } from "../utils/unsubscribe.js";
import { canTransition, type CampaignLifecycle } from "../utils/campaign.js";
import { getUnsubscribedSet } from "./unsubscribeService.js";
import { enqueueSmsJobs, removeQueuedJobsForCampaign } from "../queues/smsQueue.js";

export async function listCampaigns() {
  return prisma.campaign.findMany({
    include: {
      list: true,
      _count: { select: { recipients: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(id: string) {
  return prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: { list: true },
  });
}

export async function createCampaign(input: { name: string; message: string; listId?: string; scheduledAt?: string }) {
  if (!input.name?.trim() || !input.message?.trim()) {
    throw Object.assign(new Error("Nom et message requis"), { status: 400 });
  }
  return prisma.campaign.create({
    data: {
      name: input.name.trim(),
      message: input.message,
      listId: input.listId,
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

export async function startCampaign(id: string) {
  const current = await prisma.campaign.findUniqueOrThrow({ where: { id } });
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
      where: { campaignId: id, status: "SENT" },
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
    })),
  );

  return { queued: queued.recipients.length };
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

export async function campaignStats(id: string) {
  const groups = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId: id },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const sent = counts.SENT ?? 0;
  const failed = counts.FAILED ?? 0;
  const queued = (counts.QUEUED ?? 0) + (counts.SENDING ?? 0);
  const cancelled = counts.CANCELLED ?? 0;
  const total = sent + failed + queued + cancelled;
  const progress = total === 0 ? 0 : Math.round((sent / total) * 100);
  return { sent, failed, queued, cancelled, total, progress };
}

export async function maybeCompleteCampaign(campaignId: string) {
  const pending = await prisma.campaignRecipient.count({
    where: { campaignId, status: { in: ["QUEUED", "SENDING"] } },
  });
  if (pending === 0) {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
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
    prisma.campaignRecipient.count({ where: { status: "SENT" } }),
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
