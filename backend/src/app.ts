import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { api } from "./routes/api.js";
import { errorHandler } from "./middleware/auth.js";
import { logger } from "./utils/logger.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin.split(",").map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use("/api", api);
  app.use(errorHandler);
  return app;
}
