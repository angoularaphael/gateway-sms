import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { validatePhone } from "../utils/phone.js";

const schema = z.object({
  telephone: z.string().min(6),
  reason: z.string().optional(),
});

export async function unsubscribe(input: unknown) {
  const data = schema.parse(input);
  const phone = validatePhone(data.telephone, false);
  if (!phone.ok || !phone.normalized) {
    throw Object.assign(new Error("Numéro invalide"), { status: 400, code: "INVALID_NUMBER" });
  }
  return prisma.unsubscribe.upsert({
    where: { telephone: phone.normalized },
    update: { reason: data.reason },
    create: { telephone: phone.normalized, reason: data.reason },
  });
}

export async function listUnsubscribes() {
  return prisma.unsubscribe.findMany({ orderBy: { createdAt: "desc" } });
}

export async function isPhoneUnsubscribed(telephone: string): Promise<boolean> {
  const phone = validatePhone(telephone, false);
  const normalized = phone.normalized ?? telephone;
  const row = await prisma.unsubscribe.findUnique({ where: { telephone: normalized } });
  return Boolean(row);
}

export async function getUnsubscribedSet(phones: string[]): Promise<Set<string>> {
  const rows = await prisma.unsubscribe.findMany({
    where: { telephone: { in: phones } },
    select: { telephone: true },
  });
  return new Set(rows.map((r) => r.telephone));
}
