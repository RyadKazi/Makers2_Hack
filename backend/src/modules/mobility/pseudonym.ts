/**
 * Daily pseudonyms: pseudoId = HMAC-SHA256(PSEUDONYM_SECRET, userId | dayKey | dailySalt).
 *
 * - Rotates every Africa/Algiers day: trips of different days cannot be linked.
 * - No user id is ever stored with mobility data; admins only ever see aggregates.
 * - The server can recompute a user's pseudonyms while the daily salts exist (30 days),
 *   which is what makes "delete my data" possible. Salts are then deleted with the raw
 *   data, and nothing can link the remaining aggregates to anyone.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { algiersDayKey } from '../../lib/time.js';

export function computePseudoId(userId: string, dayKey: string, salt: string, secret = env.PSEUDONYM_SECRET): string {
  return createHmac('sha256', secret).update(`${userId}|${dayKey}|${salt}`).digest('base64url').slice(0, 32);
}

const saltCache = new Map<string, string>();

/** Salt of a day, created on first use (race-safe). Returns null for a day whose salt was deleted. */
export async function dailySalt(dayKey: string, create = true, db: PrismaClient = prisma): Promise<string | null> {
  const cached = saltCache.get(dayKey);
  if (cached) return cached;
  if (create) {
    await db.$executeRaw`INSERT INTO pseudonym_salts ("dayKey", salt) VALUES (${dayKey}, ${randomBytes(32).toString('hex')}) ON CONFLICT ("dayKey") DO NOTHING`;
  }
  const row = await db.pseudonymSalt.findUnique({ where: { dayKey } });
  if (!row) return null;
  if (saltCache.size > 64) saltCache.clear();
  saltCache.set(dayKey, row.salt);
  return row.salt;
}

export function forgetSalt(dayKey?: string): void {
  if (dayKey) saltCache.delete(dayKey);
  else saltCache.clear();
}

/** Today's pseudonym of a user. */
export async function pseudoIdFor(userId: string, now: Date): Promise<{ pseudoId: string; dayKey: string }> {
  const dayKey = algiersDayKey(now);
  const salt = (await dailySalt(dayKey))!;
  return { pseudoId: computePseudoId(userId, dayKey, salt), dayKey };
}

/** The user's pseudonym for a past day, or null once that day's salt is gone. */
export async function pseudoIdForDay(userId: string, dayKey: string): Promise<string | null> {
  const salt = await dailySalt(dayKey, false);
  return salt ? computePseudoId(userId, dayKey, salt) : null;
}

/** Every pseudonym of a user that can still be recomputed (for data deletion). */
export async function retainedPseudoIds(userId: string): Promise<string[]> {
  const salts = await prisma.pseudonymSalt.findMany();
  return salts.map((s) => computePseudoId(userId, s.dayKey, s.salt));
}
