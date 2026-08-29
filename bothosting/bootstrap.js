#!/usr/bin/env node
/**
 * Bot Hosting — copier ce fichier en /home/container/index.js
 * Startup panel : node index.js
 *
 * 1) charge /home/container/.env
 * 2) git clone/pull de gateway-sms
 * 3) npm install + prisma + build frontend
 * 4) lance l'API (dashboard + /api sur le même PORT)
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
const FRONTEND_DIR = path.join(APP_DIR, "frontend");

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

function run(cmd, cwd = ROOT) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: process.env, shell: true });
}

function resolvePort() {
  const raw = process.env.SERVER_PORT || process.env.PORT || "21819";
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

loadRootEnv();
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

if (fs.existsSync(ROOT_ENV)) {
  fs.copyFileSync(ROOT_ENV, path.join(BACKEND_DIR, ".env"));
  console.log("[sms-gateway bootstrap] .env copié vers backend/");
}

run("npm install", BACKEND_DIR);
run("npx prisma generate", BACKEND_DIR);
run("npx prisma migrate deploy", BACKEND_DIR);
try {
  run("npm run prisma:seed", BACKEND_DIR);
} catch (err) {
  console.warn("[sms-gateway bootstrap] seed ignoré:", err.message);
}

process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
run("npm install", FRONTEND_DIR);
run("npm run build", FRONTEND_DIR);

process.env.FRONTEND_DIR = path.join(FRONTEND_DIR, "out");
console.log("[sms-gateway bootstrap] démarrage API + dashboard…");
process.chdir(BACKEND_DIR);
require("child_process").execSync("npx tsx src/index.ts", {
  cwd: BACKEND_DIR,
  stdio: "inherit",
  env: process.env,
  shell: true,
});
