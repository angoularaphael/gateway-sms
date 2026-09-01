-- AlterEnum
ALTER TYPE "SmsStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "preferredSimSlot" INTEGER;

-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
