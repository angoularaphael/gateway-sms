#!/usr/bin/env node
/**
 * Redis local dans le container Bot Hosting (127.0.0.1).
 * Aucun plafond de commandes — contrairement au plan gratuit Upstash.
 */
"use strict";

const fs = require("fs");
const https = require("https");
const net = require("net");
const path = require("path");
const { spawn, execSync } = require("child_process");

const DEFAULT_PORT = Number(process.env.REDIS_LOCAL_PORT || 16379);
const BINARY_URL =
  process.env.REDIS_BINARY_URL ||
  "https://github.com/phlummox-dev/redis-static-binaries/releases/download/6.2.5.0/redis-server";

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || "/home/container";
}

function redisRoot() {
  return process.env.REDIS_HOME || path.join(homeDir(), ".sms-redis");
}

function isUpstashUrl(url) {
  return /upstash\.io/i.test(String(url || ""));
}

function shouldUseEmbeddedRedis() {
  if (process.env.REDIS_EMBEDDED === "0") return false;
  if (process.env.REDIS_EMBEDDED === "1") return true;
  return isUpstashUrl(process.env.REDIS_URL);
}

function pingRedis(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }, () => {
      sock.write("PING\r\n");
    });
    sock.setTimeout(2500);
    sock.once("data", (buf) => {
      sock.end();
      if (String(buf).includes("PONG")) resolve(true);
      else reject(new Error("réponse Redis inattendue"));
    });
    sock.once("error", reject);
    sock.once("timeout", () => {
      sock.destroy();
      reject(new Error("timeout PING Redis"));
    });
  });
}

async function waitForRedis(port, timeoutMs = 20_000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await pingRedis(port);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr || new Error("Redis local n'a pas démarré");
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;
    const get = (u, redirects = 0) => {
      if (redirects > 8) return reject(new Error("trop de redirections"));
      https
        .get(u, { headers: { "User-Agent": "sms-gateway-redis" } }, (res) => {
          const loc = res.headers.location;
          if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            res.resume();
            const next = loc.startsWith("http") ? loc : new URL(loc, u).href;
            return get(next, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`téléchargement redis-server HTTP ${res.statusCode}`));
          }
          const file = fs.createWriteStream(tmp);
          res.pipe(file);
          file.on("finish", () => {
            file.close(() => {
              fs.renameSync(tmp, dest);
              resolve();
            });
          });
          file.on("error", reject);
        })
        .on("error", reject);
    };
    get(url);
  });
}

function systemRedisBinary() {
  try {
    const out = execSync("command -v redis-server", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function ensureBinary() {
  const system = systemRedisBinary();
  if (system) return system;

  if (process.platform !== "linux") {
    throw new Error(
      "Redis embarqué : Linux uniquement (Bot Hosting). En local Windows, lance `docker compose up -d redis`.",
    );
  }
  if (process.arch !== "x64") {
    throw new Error(`Redis embarqué : binaire x64 uniquement (arch=${process.arch})`);
  }

  const root = redisRoot();
  fs.mkdirSync(root, { recursive: true });
  const bin = path.join(root, "redis-server");
  const st = fs.existsSync(bin) ? fs.statSync(bin) : null;
  if (st && st.size > 1_000_000) {
    try {
      fs.chmodSync(bin, 0o755);
    } catch {
      /* ignore */
    }
    return bin;
  }

  console.log("[sms-gateway redis] téléchargement redis-server statique (~12 Mo)…");
  await downloadFile(BINARY_URL, bin);
  fs.chmodSync(bin, 0o755);
  console.log("[sms-gateway redis] binaire prêt:", bin);
  return bin;
}

function spawnRedis(bin, port, dataDir) {
  const args = [
    "--bind",
    "127.0.0.1",
    "--port",
    String(port),
    "--dir",
    dataDir,
    "--dbfilename",
    "dump.rdb",
    "--save",
    "60",
    "1",
    "--appendonly",
    "no",
    "--maxmemory",
    "64mb",
    "--maxmemory-policy",
    "allkeys-lru",
    "--protected-mode",
    "yes",
    "--daemonize",
    "no",
    "--loglevel",
    "notice",
  ];
  const child = spawn(bin, args, {
    cwd: dataDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child;
}

async function startLocalRedis(opts = {}) {
  const port = Number(opts.port || DEFAULT_PORT);
  const url = `redis://127.0.0.1:${port}`;

  try {
    await pingRedis(port);
    console.log(`[sms-gateway redis] déjà en écoute ${url}`);
    return { url, port, alreadyRunning: true };
  } catch {
    /* start */
  }

  const dataDir = path.join(redisRoot(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const bin = await ensureBinary();
  console.log(`[sms-gateway redis] démarrage ${bin} → ${url}`);
  spawnRedis(bin, port, dataDir);
  await waitForRedis(port);
  console.log(`[sms-gateway redis] OK ${url} (pas de quota Upstash)`);
  return { url, port, alreadyRunning: false };
}

module.exports = {
  shouldUseEmbeddedRedis,
  startLocalRedis,
  isUpstashUrl,
};

if (require.main === module) {
  startLocalRedis()
    .then((r) => {
      console.log(r.url);
    })
    .catch((err) => {
      console.error("[sms-gateway redis]", err.message || err);
      process.exit(1);
    });
}
