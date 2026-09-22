#!/usr/bin/env node
/**
 * Bot Hosting — copier ce fichier en /home/container/index.js
 * Startup panel : node index.js
 *
 * Ne compile PAS Next.js sur le panel (OOM). Le dashboard statique
 * est dans le repo : dashboard/
 */
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const GITHUB_REPO_URL =
  process.env.BOT_GITHUB_REPO || "https://github.com/angoularaphael/gateway-sms.git";
const BRANCH = process.env.BOT_REPO_BRANCH || "main";
const APP_DIR_NAME = process.env.BOT_APP_DIR || "sms-gateway-app";

const ROOT = __dirname;
const ROOT_ENV = path.join(ROOT, ".env");
const APP_DIR = path.join(ROOT, APP_DIR_NAME);
const BACKEND_DIR = path.join(APP_DIR, "backend");
const DASHBOARD_DIR = path.join(APP_DIR, "dashboard");

function loadRootEnv() {
  if (!fs.existsSync(ROOT_ENV)) {
    console.warn("[sms-gateway bootstrap] .env manquant à côté de index.js");
    return;
  }
  for (const line of fs.readFileSync(ROOT_ENV, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = val;
  }
}

function rewriteEnvRedisUrl(file, url) {
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, "utf8");
  if (/^REDIS_URL=/m.test(text)) {
    text = text.replace(/^REDIS_URL=.*$/m, `REDIS_URL=${url}`);
  } else {
    text += `\nREDIS_URL=${url}\n`;
  }
  if (/^REDIS_EMBEDDED=/m.test(text)) {
    text = text.replace(/^REDIS_EMBEDDED=.*$/m, "REDIS_EMBEDDED=1");
  } else {
    text += "REDIS_EMBEDDED=1\n";
  }
  fs.writeFileSync(file, text);
}

async function startEmbeddedRedis() {
  const helper = path.join(APP_DIR, "bothosting", "local-redis.js");
  if (!fs.existsSync(helper)) {
    console.warn("[sms-gateway bootstrap] bothosting/local-redis.js absent — Redis au démarrage API");
    return;
  }
  const { shouldUseEmbeddedRedis, startLocalRedis } = require(helper);
  if (!shouldUseEmbeddedRedis()) {
    console.log("[sms-gateway bootstrap] Redis distant (REDIS_EMBEDDED=0)");
    return;
  }
  const { url } = await startLocalRedis();
  process.env.REDIS_URL = url;
  process.env.REDIS_EMBEDDED = "1";
  if (fs.existsSync(ROOT_ENV)) rewriteEnvRedisUrl(ROOT_ENV, url);
}

function run(cmd, cwd = ROOT) {
  console.log(`> ${cmd}`);
  const env = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=512",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
  };
  execSync(cmd, { cwd, stdio: "inherit", env, shell: true });
}

function resolvePort() {
  const raw = process.env.SERVER_PORT || process.env.PORT || "21724";
  const port = String(raw).trim();
  if (!/^\d+$/.test(port)) {
    console.error("[sms-gateway bootstrap] PORT / SERVER_PORT invalide");
    process.exit(1);
  }
  return port;
}

function cloneOrUpdate() {
  const gitDir = path.join(APP_DIR, ".git");
  if (!fs.existsSync(gitDir)) {
    if (fs.existsSync(APP_DIR)) fs.rmSync(APP_DIR, { recursive: true, force: true });
    console.log(`[sms-gateway bootstrap] clone ${GITHUB_REPO_URL} (${BRANCH})`);
    run(`git clone --depth 1 --branch ${BRANCH} ${GITHUB_REPO_URL} "${APP_DIR_NAME}"`);
    return;
  }
  console.log("[sms-gateway bootstrap] mise à jour repo…");
  try {
    run("git fetch origin", APP_DIR);
    run(`git reset --hard origin/${BRANCH}`, APP_DIR);
  } catch (err) {
    console.warn("[sms-gateway bootstrap] git update ignoré:", err.message);
  }
}

async function main() {
  loadRootEnv();
  if (process.env.REDIS_EMBEDDED !== "0") process.env.REDIS_EMBEDDED = "1";

  const PORT = resolvePort();
  process.env.PORT = PORT;
  process.env.SERVER_PORT = process.env.SERVER_PORT || PORT;
  process.env.HOST = process.env.HOST || "0.0.0.0";
  process.env.NODE_ENV = process.env.NODE_ENV || "production";

  console.log("=== SMS GATEWAY — BOT HOSTING ===");
  console.log(`repo  ${GITHUB_REPO_URL}#${BRANCH}`);
  console.log(`app   ${APP_DIR}`);
  console.log(`port  ${PORT}`);

  cloneOrUpdate();
  await startEmbeddedRedis();

  if (fs.existsSync(ROOT_ENV)) {
    fs.copyFileSync(ROOT_ENV, path.join(BACKEND_DIR, ".env"));
    console.log("[sms-gateway bootstrap] .env copié vers backend/");
  }

  const distEntry = path.join(BACKEND_DIR, "dist", "index.js");
  const needsBuild = !fs.existsSync(distEntry) || process.env.SMS_GATEWAY_FORCE_BUILD === "1";

  const hasModules = fs.existsSync(path.join(BACKEND_DIR, "node_modules", "express"));
  if (!hasModules || needsBuild) {
    run("npm install --no-audit --no-fund", BACKEND_DIR);
  } else {
    console.log("[sms-gateway bootstrap] node_modules déjà présent, npm install sauté");
  }

  if (needsBuild) {
    console.log("[sms-gateway bootstrap] compilation TypeScript (dist/)…");
    run("npm run build", BACKEND_DIR);
    try {
      run("npm prune --omit=dev", BACKEND_DIR);
    } catch (err) {
      console.warn("[sms-gateway bootstrap] npm prune ignoré:", err.message);
    }
  }

  if (!fs.existsSync(distEntry)) {
    console.error("[sms-gateway bootstrap] dist/index.js introuvable après build");
    process.exit(1);
  }

  run("npx prisma generate", BACKEND_DIR);
  run("npx prisma migrate deploy", BACKEND_DIR);
  if (process.env.SMS_GATEWAY_RUN_SEED === "1") {
    try {
      run("npm run prisma:seed", BACKEND_DIR);
    } catch (err) {
      console.warn("[sms-gateway bootstrap] seed ignoré:", err.message);
    }
  } else {
    console.log("[sms-gateway bootstrap] seed sauté (SMS_GATEWAY_RUN_SEED!=1)");
  }

  if (!fs.existsSync(path.join(DASHBOARD_DIR, "index.html"))) {
    console.warn("[sms-gateway bootstrap] dashboard/index.html introuvable — API seule");
  }

  process.env.FRONTEND_DIR = DASHBOARD_DIR;
  console.log("[sms-gateway bootstrap] démarrage API + dashboard (node dist)…");
  process.chdir(BACKEND_DIR);
  const { spawn } = require("child_process");
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: BACKEND_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=512",
    },
  });
  child.on("exit", (code, signal) => {
    console.error("[sms-gateway bootstrap] API arrêtée", { code, signal });
    process.exit(code == null ? 1 : code);
  });
}

main().catch((err) => {
  console.error("[sms-gateway bootstrap] échec:", err && err.message ? err.message : err);
  process.exit(1);
});
