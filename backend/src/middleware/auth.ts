import type { Request, Response, NextFunction } from "express";
import { verifyJwt } from "../services/authService.js";
import { authenticateDevice } from "../services/deviceService.js";

export function authJwt(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  try {
    const payload = verifyJwt(token);
    (req as Request & { userId: string }).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Token invalide" });
  }
}

export async function authDevice(req: Request, res: Response, next: NextFunction) {
  const deviceId = String(req.params.id ?? req.headers["x-device-id"] ?? "");
  const apiKey = String(req.headers["x-api-key"] ?? "");
  if (!deviceId || !apiKey) {
    res.status(401).json({ error: "API key requise" });
    return;
  }
  const device = await authenticateDevice(deviceId, apiKey);
  if (!device) {
    res.status(401).json({ error: "Appareil non autorisé" });
    return;
  }
  (req as Request & { device: typeof device }).device = device;
  next();
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { status?: number; message?: string; issues?: unknown };
  const status = e.status ?? (e.issues ? 400 : 500);
  res.status(status).json({ error: e.message ?? "Erreur serveur" });
}
