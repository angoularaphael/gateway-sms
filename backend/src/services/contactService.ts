import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { parseContactsCsv } from "../utils/csv.js";
import { validatePhone } from "../utils/phone.js";

const createSchema = z.object({
  prenom: z.string().min(1),
  nom: z.string().min(1),
  telephone: z.string().min(6),
});

export async function listContacts(query: { search?: string; skip?: number; take?: number }) {
  const where = query.search
    ? {
        OR: [
          { prenom: { contains: query.search, mode: "insensitive" as const } },
          { nom: { contains: query.search, mode: "insensitive" as const } },
          { telephone: { contains: query.search } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: query.skip ?? 0,
      take: Math.min(query.take ?? 50, 200),
    }),
    prisma.contact.count({ where }),
  ]);
  return { items, total };
}

export async function createContact(input: unknown) {
  const data = createSchema.parse(input);
  const phone = validatePhone(data.telephone);
  if (!phone.ok || !phone.normalized) {
    throw Object.assign(new Error("Numéro invalide"), { status: 400, code: "INVALID_NUMBER" });
  }
  const existing = await prisma.contact.findUnique({ where: { telephone: phone.normalized } });
  if (existing) {
    throw Object.assign(new Error("Contact déjà existant"), { status: 409 });
  }
  return prisma.contact.create({
    data: { prenom: data.prenom, nom: data.nom, telephone: phone.normalized },
  });
}

export async function deleteContact(id: string) {
  await prisma.contact.delete({ where: { id } });
}

export async function importCsv(content: string, listId?: string) {
  const parsed = parseContactsCsv(content);
  const existing = await prisma.contact.findMany({
    where: { telephone: { in: parsed.valid.map((c) => c.telephone) } },
    select: { telephone: true },
  });
  const existingSet = new Set(existing.map((e) => e.telephone));
  const toInsert = parsed.valid.filter((c) => !existingSet.has(c.telephone));
  const skippedDuplicates = parsed.valid.length - toInsert.length;

  const created = await prisma.$transaction(
    toInsert.map((c) => prisma.contact.create({ data: c })),
  );

  if (listId) {
    const inList = await prisma.contact.findMany({
      where: { telephone: { in: parsed.valid.map((c) => c.telephone) } },
      select: { id: true },
    });
    if (inList.length > 0) {
      await prisma.contactListMember.createMany({
        data: inList.map((c) => ({ listId, contactId: c.id })),
        skipDuplicates: true,
      });
    }
  }

  return {
    created: created.length,
    skippedDuplicates,
    fileDuplicates: parsed.duplicatesInFile.length,
    errors: parsed.errors,
    contacts: created,
  };
}

export function exportContactsCsv(
  contacts: Array<{ prenom: string; nom: string; telephone: string }>,
): string {
  const header = "prenom,nom,telephone";
  const rows = contacts.map((c) => `${escapeCsv(c.prenom)},${escapeCsv(c.nom)},${c.telephone}`);
  return [header, ...rows].join("\n");
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function listContactLists() {
  return prisma.contactList.findMany({
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createContactList(name: string) {
  return prisma.contactList.create({ data: { name } });
}

export async function addContactsToList(listId: string, contactIds: string[]) {
  await prisma.contactListMember.createMany({
    data: contactIds.map((contactId) => ({ listId, contactId })),
    skipDuplicates: true,
  });
  return prisma.contactList.findUniqueOrThrow({
    where: { id: listId },
    include: { _count: { select: { members: true } } },
  });
}
