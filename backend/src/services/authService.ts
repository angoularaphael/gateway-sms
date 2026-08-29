import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../utils/prisma.js";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), "Email invalide"),
  password: z.string().min(8),
});

export async function login(email: string, password: string) {
  const parsed = loginSchema.parse({ email, password });
  const user = await prisma.user.findUnique({ where: { email: parsed.email.toLowerCase() } });
  if (!user) {
    throw Object.assign(new Error("Identifiants invalides"), { status: 401 });
  }
  const ok = await bcrypt.compare(parsed.password, user.passwordHash);
  if (!ok) {
    throw Object.assign(new Error("Identifiants invalides"), { status: 401 });
  }
  const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as SignOptions);
  return { token, user: { id: user.id, email: user.email, name: user.name } };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, 10);
}

export function generateApiKey(): string {
  return `sgw_${crypto.randomBytes(24).toString("hex")}`;
}

export function generateDeviceId(index: number): string {
  return `ANDROID-${String(index).padStart(3, "0")}`;
}

export function verifyJwt(token: string): { sub: string; email: string } {
  return jwt.verify(token, config.jwtSecret) as { sub: string; email: string };
}
