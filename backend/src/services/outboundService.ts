import { prisma } from "../utils/prisma.js";
import { validatePhone } from "../utils/phone.js";
import { toGsmSafe } from "../utils/template.js";
import { enqueueSmsJobs } from "../queues/smsQueue.js";
import { isPhoneUnsubscribed } from "./unsubscribeService.js";

export const SYSTEM_OUTBOUND_NAME = "Messages logiciels";

async function ensureSystemCampaign() {
  const existing = await prisma.campaign.findFirst({
    where: { name: SYSTEM_OUTBOUND_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    if (existing.status !== "RUNNING") {
      return prisma.campaign.update({
        where: { id: existing.id },
        data: { status: "RUNNING", startedAt: existing.startedAt ?? new Date() },
      });
    }
    return existing;
  }
  return prisma.campaign.create({
    data: {
      name: SYSTEM_OUTBOUND_NAME,
      message: "{message}",
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

export async function sendDirectMessage(input: {
  telephone: string;
  message: string;
  prenom?: string;
  nom?: string;
  source?: string;
  simSlot?: number;
}) {
  const phone = validatePhone(input.telephone);
  if (!phone.ok || !phone.normalized) {
    throw Object.assign(new Error("Numéro invalide"), { status: 400, code: "INVALID_NUMBER" });
  }
  const text = toGsmSafe(input.message);
  if (!text) {
    throw Object.assign(new Error("Message vide"), { status: 400 });
  }
  if (await isPhoneUnsubscribed(phone.normalized)) {
    throw Object.assign(new Error("Numéro désinscrit"), { status: 400, code: "UNSUBSCRIBED" });
  }

  const campaign = await ensureSystemCampaign();
  const prenom = String(input.prenom || "Client").trim() || "Client";
  const nom = String(input.nom || input.source || "-").trim() || "-";

  const contact = await prisma.contact.upsert({
    where: { telephone: phone.normalized },
    create: { prenom, nom, telephone: phone.normalized },
    update: {},
  });

  const recipient = await prisma.campaignRecipient.create({
    data: {
      campaignId: campaign.id,
      contactId: contact.id,
      phoneNumber: phone.normalized,
      message: text,
      status: "QUEUED",
    },
  });

  await enqueueSmsJobs([
    {
      recipientId: recipient.id,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneNumber: phone.normalized,
      message: text,
      preferredSim: input.simSlot === 1 || input.simSlot === 2 ? input.simSlot : undefined,
    },
  ]);

  return {
    queued: true,
    via: "sms" as const,
    recipientId: recipient.id,
    telephone: phone.normalized,
  };
}
