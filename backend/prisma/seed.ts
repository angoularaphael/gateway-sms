import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { OFFER_CAMPAIGN_MESSAGE, OFFER_CAMPAIGN_NAME } from "../src/utils/defaultCampaign.js";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@localhost").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "changeme";
  const name = process.env.ADMIN_NAME ?? "Administrateur";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash },
    create: { email, passwordHash, name },
  });
  await prisma.user.deleteMany({ where: { email: "admin@localhost" } });

  const list = await prisma.contactList.upsert({
    where: { id: "seed-offre-bc" },
    update: { name: "Offre spéciale Boxing Center" },
    create: { id: "seed-offre-bc", name: "Offre spéciale Boxing Center" },
  });

  const existing = await prisma.campaign.findFirst({
    where: { name: OFFER_CAMPAIGN_NAME, status: "DRAFT" },
  });
  if (existing) {
    await prisma.campaign.update({
      where: { id: existing.id },
      data: { message: OFFER_CAMPAIGN_MESSAGE, listId: list.id },
    });
  } else {
    await prisma.campaign.create({
      data: {
        name: OFFER_CAMPAIGN_NAME,
        message: OFFER_CAMPAIGN_MESSAGE,
        listId: list.id,
        status: "DRAFT",
      },
    });
  }

  console.log(`Admin prêt : ${email}`);
  console.log(`Campagne prête : ${OFFER_CAMPAIGN_NAME}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
