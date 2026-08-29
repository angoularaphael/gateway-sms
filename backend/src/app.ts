import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { api } from "./routes/api.js";
import { errorHandler } from "./middleware/auth.js";
import { logger } from "./utils/logger.js";

function resolveFrontendDir(): string | null {
  const candidates = [
    config.frontendDir,
    path.resolve(process.cwd(), "frontend/out"),
    path.resolve(process.cwd(), "../frontend/out"),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

export function createApp() {
  const app = express();
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  const origins = config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: origins.length === 1 && origins[0] === "*" ? true : origins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use("/api", api);

  const frontendDir = resolveFrontendDir();
  if (frontendDir) {
    app.use(express.static(frontendDir));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
        next();
        return;
      }
      if (path.extname(req.path)) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  app.use(errorHandler);
  return app;
}
