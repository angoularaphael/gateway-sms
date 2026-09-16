-- Daily SMS cap 200 → 500 on existing and new SIM lines
ALTER TABLE "SimLine" ALTER COLUMN "dailyLimit" SET DEFAULT 500;
UPDATE "SimLine" SET "dailyLimit" = 500 WHERE "dailyLimit" < 500;
