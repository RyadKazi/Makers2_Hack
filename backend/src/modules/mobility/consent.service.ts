import { HttpError } from '../../lib/errors.js';
import type { Lang } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { POLICY_SUMMARY, POLICY_VERSION, RAW_RETENTION_DAYS } from './privacy.js';
import { retainedPseudoIds } from './pseudonym.js';
import { endActiveSessionsOf } from './sessions.service.js';

export type ConsentDto = {
  granted: boolean;
  upToDate: boolean;
  policyVersion: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  currentPolicy: { version: string; summary: string[]; retentionDays: number };
};

async function load(userId: string) {
  return prisma.mobilityConsent.findUnique({ where: { userId } });
}

function toDto(row: Awaited<ReturnType<typeof load>>, lang: Lang): ConsentDto {
  const granted = !!row && row.revokedAt === null;
  return {
    granted,
    upToDate: granted && row!.policyVersion === POLICY_VERSION,
    policyVersion: row?.policyVersion ?? null,
    grantedAt: row?.grantedAt.toISOString() ?? null,
    revokedAt: row?.revokedAt?.toISOString() ?? null,
    currentPolicy: { version: POLICY_VERSION, summary: POLICY_SUMMARY[lang], retentionDays: RAW_RETENTION_DAYS },
  };
}

/** Throws 403 unless the user has an active consent to the current policy version. */
export async function assertConsent(userId: string): Promise<void> {
  const row = await load(userId);
  if (!row || row.revokedAt !== null) throw new HttpError(403, 'CONSENT_REQUIRED', 'Turn on location sharing first (consent required)');
  if (row.policyVersion !== POLICY_VERSION) {
    throw new HttpError(403, 'CONSENT_OUTDATED', 'The data policy changed: please review and accept it again', { currentPolicyVersion: POLICY_VERSION });
  }
}

export async function getConsent(userId: string, lang: Lang): Promise<ConsentDto> {
  return toDto(await load(userId), lang);
}

export async function grantConsent(userId: string, policyVersion: string, now: Date, lang: Lang): Promise<ConsentDto> {
  if (policyVersion !== POLICY_VERSION) {
    throw new HttpError(409, 'POLICY_OUTDATED', 'You accepted an older version of the policy', { currentPolicyVersion: POLICY_VERSION });
  }
  const row = await prisma.mobilityConsent.upsert({
    where: { userId },
    create: { userId, policyVersion, grantedAt: now },
    update: { policyVersion, grantedAt: now, revokedAt: null },
  });
  return toDto(row, lang);
}

export type DeletionResult = { sessions: number; points: number; events: number };

/**
 * Deletes everything that can still be linked to the user: sessions recorded under any
 * pseudonym recomputable from the retained daily salts (points cascade, events too).
 * Aggregates (k-anonymous) refresh at the next 5-minute run.
 */
export async function deleteMobilityData(userId: string): Promise<DeletionResult> {
  const pseudoIds = await retainedPseudoIds(userId);
  if (pseudoIds.length === 0) return { sessions: 0, points: 0, events: 0 };
  return prisma.$transaction(async (tx) => {
    const sessions = await tx.trackingSession.findMany({ where: { pseudoId: { in: pseudoIds } }, select: { id: true } });
    const ids = sessions.map((s) => s.id);
    const points = await tx.trackPoint.count({ where: { sessionId: { in: ids } } });
    const events = await tx.difficultyEvent.deleteMany({ where: { OR: [{ sessionId: { in: ids } }, { pseudoId: { in: pseudoIds } }] } });
    await tx.trackingSession.deleteMany({ where: { id: { in: ids } } });
    return { sessions: ids.length, points, events: events.count };
  });
}

export type RevokeResult = {
  consent: ConsentDto;
  endedSession: boolean;
  deleted: DeletionResult | null;
  /** Offered when the user did not ask for deletion right away. */
  deletionOffer: { available: boolean; endpoint: string; retainedDays: number } | null;
};

export async function revokeConsent(userId: string, deleteData: boolean, now: Date, lang: Lang): Promise<RevokeResult> {
  const existing = await load(userId);
  const endedSession = await endActiveSessionsOf(userId, 'CONSENT_WITHDRAWN', now);
  const row = existing ? await prisma.mobilityConsent.update({ where: { userId }, data: { revokedAt: existing.revokedAt ?? now } }) : null;
  const deleted = deleteData ? await deleteMobilityData(userId) : null;
  return {
    consent: toDto(row, lang),
    endedSession,
    deleted,
    deletionOffer: deleteData ? null : { available: true, endpoint: 'DELETE /api/mobility/data', retainedDays: RAW_RETENTION_DAYS },
  };
}
