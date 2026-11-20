/**
 * Tracking sessions. A session row holds a daily pseudonym, a coarse needs
 * category and timestamps — never a user id. Ownership is checked by
 * recomputing the caller's pseudonym for the session's day.
 */
import type { MobilityProfile, SessionEndReason, TrackingSession } from '@prisma/client';
import { HttpError } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import type { Lang } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { algiersDayBounds, algiersDayKey, algiersTime } from '../../lib/time.js';
import { REMINDER_BEFORE_MS, SESSION_MAX_MS, type NeedsCategory } from './privacy.js';
import { pseudoIdFor, pseudoIdForDay } from './pseudonym.js';

export type AutoStopReason = 'TIME_LIMIT' | 'DAILY_RESET';

/** When and why an active session will stop by itself: 3 hours after start, or midnight, whichever is first. */
export function autoStopOf(session: Pick<TrackingSession, 'startedAt' | 'dayKey'>): { at: Date; reason: AutoStopReason } {
  const limit = new Date(session.startedAt.getTime() + SESSION_MAX_MS);
  const midnight = algiersDayBounds(algiersTime(session.dayKey, 12)).end;
  return limit.getTime() <= midnight.getTime() ? { at: limit, reason: 'TIME_LIMIT' } : { at: midnight, reason: 'DAILY_RESET' };
}

export async function endSession(id: string, reason: SessionEndReason, at: Date): Promise<TrackingSession | null> {
  const ended = await prisma.trackingSession.updateMany({ where: { id, endedAt: null }, data: { endedAt: at, endReason: reason } });
  if (ended.count === 0) return null;
  const session = await prisma.trackingSession.findUnique({ where: { id } });
  bus.emit('mobility.sessionEnded', { reason });
  return session;
}

/** Ends the session if its 3-hour or midnight limit has passed. Returns the up-to-date row. */
export async function applyAutoStop(session: TrackingSession, now: Date): Promise<TrackingSession> {
  if (session.endedAt) return session;
  const stop = autoStopOf(session);
  if (now.getTime() < stop.at.getTime()) return session;
  return (await endSession(session.id, stop.reason, stop.at)) ?? (await prisma.trackingSession.findUniqueOrThrow({ where: { id: session.id } }));
}

/** Job: stops every session past its limit. */
export async function autoStopDueSessions(now: Date): Promise<number> {
  const today = algiersDayKey(now);
  const due = await prisma.trackingSession.findMany({
    where: { endedAt: null, OR: [{ startedAt: { lte: new Date(now.getTime() - SESSION_MAX_MS) } }, { dayKey: { not: today } }] },
  });
  for (const s of due) await applyAutoStop(s, now);
  return due.length;
}

/** Loads a session that belongs to the user. 404 otherwise (never reveals other people's sessions). */
export async function ownedSession(userId: string, sessionId: string): Promise<TrackingSession> {
  const session = await prisma.trackingSession.findUnique({ where: { id: sessionId } });
  const pseudoId = session ? await pseudoIdForDay(userId, session.dayKey) : null;
  if (!session || !pseudoId || pseudoId !== session.pseudoId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Tracking session not found');
  return session;
}

export async function endActiveSessionsOf(userId: string, reason: SessionEndReason, now: Date): Promise<boolean> {
  const { pseudoId } = await pseudoIdFor(userId, now);
  const active = await prisma.trackingSession.findMany({ where: { pseudoId, endedAt: null }, select: { id: true } });
  for (const s of active) await endSession(s.id, reason, now);
  return active.length > 0;
}

// ───────────── status DTO ─────────────

const REMINDER: Record<Lang, (time: string, reason: AutoStopReason) => string> = {
  fr: (t, r) => `Le partage de position s’arrêtera automatiquement à ${t} (${r === 'DAILY_RESET' ? 'minuit' : 'limite de 3 heures'}).`,
  en: (t, r) => `Location sharing will stop automatically at ${t} (${r === 'DAILY_RESET' ? 'midnight' : '3-hour limit'}).`,
  ar: (t, r) => `ستتوقف مشاركة الموقع تلقائيًا على الساعة ${t} (${r === 'DAILY_RESET' ? 'منتصف الليل' : 'حد 3 ساعات'}).`,
};

const ENDED: Record<Lang, Record<SessionEndReason, string>> = {
  fr: {
    USER: 'Partage arrêté.',
    GEOFENCE_EXIT: 'Partage arrêté : vous avez quitté le campus.',
    TIME_LIMIT: 'Partage arrêté après 3 heures.',
    DAILY_RESET: 'Partage arrêté à minuit.',
    CONSENT_WITHDRAWN: 'Partage arrêté : consentement retiré.',
  },
  en: {
    USER: 'Sharing stopped.',
    GEOFENCE_EXIT: 'Sharing stopped: you left the campus.',
    TIME_LIMIT: 'Sharing stopped after 3 hours.',
    DAILY_RESET: 'Sharing stopped at midnight.',
    CONSENT_WITHDRAWN: 'Sharing stopped: consent withdrawn.',
  },
  ar: {
    USER: 'تم إيقاف المشاركة.',
    GEOFENCE_EXIT: 'تم إيقاف المشاركة: لقد غادرت الحرم الجامعي.',
    TIME_LIMIT: 'تم إيقاف المشاركة بعد 3 ساعات.',
    DAILY_RESET: 'تم إيقاف المشاركة عند منتصف الليل.',
    CONSENT_WITHDRAWN: 'تم إيقاف المشاركة: تم سحب الموافقة.',
  },
};

const localTime = (d: Date): string => new Date(d.getTime() + 3_600_000).toISOString().slice(11, 16);

export type SessionStatusDto = {
  state: 'NONE' | 'ACTIVE' | 'ENDED';
  message: string | null;
  session: {
    id: string;
    needsCategory: MobilityProfile;
    startedAt: string;
    endedAt: string | null;
    endReason: SessionEndReason | null;
    pointCount: number;
    lastPointAt: string | null;
    autoStopAt: string;
    autoStopReason: AutoStopReason;
    remainingSec: number;
    reminder: string | null;
  } | null;
};

export function toStatusDto(session: TrackingSession | null, now: Date, lang: Lang): SessionStatusDto {
  if (!session) return { state: 'NONE', message: null, session: null };
  const stop = autoStopOf(session);
  const active = session.endedAt === null;
  const remainingMs = active ? Math.max(0, stop.at.getTime() - now.getTime()) : 0;
  const reminder = active && remainingMs <= REMINDER_BEFORE_MS ? REMINDER[lang](localTime(stop.at), stop.reason) : null;
  return {
    state: active ? 'ACTIVE' : 'ENDED',
    message: active ? reminder : ENDED[lang][session.endReason ?? 'USER'],
    session: {
      id: session.id,
      needsCategory: session.mobility,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      endReason: session.endReason,
      pointCount: session.pointCount,
      lastPointAt: session.lastPointAt?.toISOString() ?? null,
      autoStopAt: stop.at.toISOString(),
      autoStopReason: stop.reason,
      remainingSec: Math.round(remainingMs / 1000),
      reminder,
    },
  };
}

// ───────────── API operations ─────────────

export async function startSession(userId: string, needsCategory: NeedsCategory | undefined, now: Date, lang: Lang): Promise<SessionStatusDto> {
  const { pseudoId, dayKey } = await pseudoIdFor(userId, now);
  // One active session at a time.
  const active = await prisma.trackingSession.findMany({ where: { pseudoId, endedAt: null }, select: { id: true } });
  for (const s of active) await endSession(s.id, 'USER', now);

  const category = needsCategory ?? (await prisma.accessibilityProfile.findUnique({ where: { userId }, select: { mobility: true } }))?.mobility ?? 'NONE';
  const session = await prisma.trackingSession.create({ data: { pseudoId, dayKey, mobility: category, startedAt: now } });
  bus.emit('mobility.sessionStarted', {});
  return toStatusDto(session, now, lang);
}

export async function stopSession(userId: string, sessionId: string, now: Date, lang: Lang): Promise<SessionStatusDto> {
  const session = await applyAutoStop(await ownedSession(userId, sessionId), now);
  const ended = session.endedAt ? session : ((await endSession(session.id, 'USER', now)) ?? session);
  return toStatusDto(ended, now, lang);
}

/** Polled by the client: the latest session of today (active, or ended with its reason). */
export async function currentStatus(userId: string, now: Date, lang: Lang): Promise<SessionStatusDto> {
  const { pseudoId } = await pseudoIdFor(userId, now);
  const latest = await prisma.trackingSession.findFirst({ where: { pseudoId, startedAt: { lte: now } }, orderBy: { startedAt: 'desc' } });
  return toStatusDto(latest ? await applyAutoStop(latest, now) : null, now, lang);
}
