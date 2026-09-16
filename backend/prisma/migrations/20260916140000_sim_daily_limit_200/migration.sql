-- Daily SMS cap 80 → 200 on existing and new SIM lines
ALTER TABLE "SimLine" ALTER COLUMN "dailyLimit" SET DEFAULT 200;
UPDATE "SimLine" SET "dailyLimit" = 200 WHERE "dailyLimit" < 200;
