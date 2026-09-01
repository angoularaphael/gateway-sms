import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "0.0.0.0",
  port: integer("PORT", integer("SERVER_PORT", integer("API_PORT", 4000))),
  apiUrl: process.env.API_URL ?? "http://localhost:4000",
  frontendUrl: process.env.FRONTEND_URL ?? process.env.API_URL ?? "http://localhost:3000",
  corsOrigin: process.env.CORS_ORIGIN ?? process.env.API_URL ?? process.env.FRONTEND_URL ?? "http://localhost:3000",
  frontendDir: process.env.FRONTEND_DIR ?? "",
  databaseUrl: required("DATABASE_URL", "postgresql://sms:sms@localhost:5432/sms_gateway?schema=public"),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  jwtSecret: required("JWT_SECRET", "dev-only-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  deviceOfflineAfterSeconds: integer("DEVICE_OFFLINE_AFTER_SECONDS", 90),
  defaultDailyLimit: integer("DEFAULT_DAILY_LIMIT", 600),
  defaultRatePerMinute: integer("DEFAULT_RATE_PER_MINUTE", 4),
  smsJobAttempts: integer("SMS_JOB_ATTEMPTS", 1),
  smsJobBackoffMs: integer("SMS_JOB_BACKOFF_MS", 60_000),
  outboundApiSecret: process.env.OUTBOUND_API_SECRET?.trim() || "",
};
