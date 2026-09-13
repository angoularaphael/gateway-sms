import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./utils/logger.js";

const require = createRequire(import.meta.url);

type LocalRedisModule = {
  shouldUseEmbeddedRedis: () => boolean;
  startLocalRedis: () => Promise<{ url: string; port: number }>;
};

function loadLocalRedisModule(): LocalRedisModule {
  const candidates = [
    path.resolve(process.cwd(), "../bothosting/local-redis.js"),
    path.resolve(process.cwd(), "bothosting/local-redis.js"),
    path.resolve(process.cwd(), "../../bothosting/local-redis.js"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return require(file) as LocalRedisModule;
  }
  throw new Error("bothosting/local-redis.js introuvable — impossible de démarrer Redis local");
}

export async function ensureLocalRedis(): Promise<void> {
  const mod = loadLocalRedisModule();
  if (!mod.shouldUseEmbeddedRedis()) {
    logger.info("Redis : URL fournie (REDIS_EMBEDDED=0 ou hors Upstash)");
    return;
  }
  const { url } = await mod.startLocalRedis();
  process.env.REDIS_URL = url;
  process.env.REDIS_EMBEDDED = "1";
  logger.info({ url }, "Redis local dans le container — plus de plafond Upstash");
}
