/**
 * Retention: raw data older than 30 days is deleted — points, difficulty events,
 * sessions — together with the daily pseudonym salts of those days. After that,
 * only k-anonymous aggregates remain and nobody can relink them to a person.
 */
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { algiersDayKey } from '../../lib/time.js';
import { RAW_RETENTION_DAYS } from './privacy.js';
import { forgetSalt } from './pseudonym.js';

export type PurgeResult = { points: number; events: number; sessions: number; salts: number };

export async function purgeExpiredRawData(now: Date): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * 86_400_000);
  const cutoffDay = algiersDayKey(cutoff);
  const [points, events, sessions, salts] = await prisma.$transaction([
    prisma.trackPoint.deleteMany({ where: { recordedAt: { lt: cutoff } } }),
    prisma.difficultyEvent.deleteMany({ where: { recordedAt: { lt: cutoff } } }),
    prisma.trackingSession.deleteMany({ where: { startedAt: { lt: cutoff }, OR: [{ endedAt: { not: null } }, { dayKey: { lt: cutoffDay } }] } }),
    prisma.pseudonymSalt.deleteMany({ where: { dayKey: { lt: cutoffDay } } }),
  ]);
  forgetSalt();
  const result = { points: points.count, events: events.count, sessions: sessions.count, salts: salts.count };
  if (result.points + result.events + result.sessions + result.salts > 0) logger.info(result, 'retention purge');
  return result;
}
