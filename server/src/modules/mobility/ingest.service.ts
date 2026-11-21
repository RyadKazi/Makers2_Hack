/**
 * Ingestion of positions and difficulty reports. Order of checks for points:
 * consent → session ownership → session still open (3 h / midnight) → time sanity
 * → accuracy ≤ 10 m → geofence (first point outside ends the session) → smoothing.
 */
import { HttpError } from '../../lib/errors.js';
import type { Lang } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { assertConsent } from './consent.service.js';
import { insideGeofence } from './geofence.js';
import { MAX_ACCURACY_M, redactNote } from './privacy.js';
import { applyAutoStop, autoStopOf, endSession, ownedSession, toStatusDto, type SessionStatusDto } from './sessions.service.js';
import { smoothTrack, type RawPoint } from './smoothing.js';

const FUTURE_TOLERANCE_MS = 2 * 60_000;

export type PointsInput = {
  sessionId: string;
  points: { recordedAt: Date; x: number; y: number; level: number; floorId?: string | undefined; accuracyM: number; routeId?: string | undefined }[];
};

export type IngestResult = {
  accepted: number;
  dropped: { lowAccuracy: number; outsideGeofence: number; jitter: number; outOfSession: number };
  session: SessionStatusDto;
};

function sessionEnded(reason: string | null): HttpError {
  return new HttpError(409, 'SESSION_ENDED', 'This tracking session has ended', { endReason: reason });
}

export async function ingestPoints(userId: string, input: PointsInput, now: Date, lang: Lang): Promise<IngestResult> {
  await assertConsent(userId);
  let session = await ownedSession(userId, input.sessionId);
  if (session.endedAt) throw sessionEnded(session.endReason);

  const dropped = { lowAccuracy: 0, outsideGeofence: 0, jitter: 0, outOfSession: 0 };
  const cutoff = autoStopOf(session).at;
  const after = session.lastPointAt ?? new Date(session.startedAt.getTime() - 60_000);

  // Time sanity: inside the session, not in the future, newer than what we already have.
  const sorted = [...input.points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  let candidates: RawPoint[] = [];
  for (const p of sorted) {
    const t = p.recordedAt.getTime();
    if (t <= after.getTime() || t >= cutoff.getTime() || t > now.getTime() + FUTURE_TOLERANCE_MS) dropped.outOfSession += 1;
    else if (p.accuracyM > MAX_ACCURACY_M) dropped.lowAccuracy += 1;
    else candidates.push({ recordedAt: p.recordedAt, x: p.x, y: p.y, level: p.level, floorId: p.floorId ?? null, accuracyM: p.accuracyM, routeId: p.routeId ?? null });
  }

  // Geofence: the first point outside campus ends the session; it and everything after it are dropped.
  let exitAt: Date | null = null;
  const inside = await insideGeofence(candidates);
  const firstOutside = inside.indexOf(false);
  if (firstOutside >= 0) {
    exitAt = candidates[firstOutside]!.recordedAt;
    dropped.outsideGeofence = candidates.length - firstOutside;
    candidates = candidates.slice(0, firstOutside);
  }

  // Smoothing, continuing from the last stored point.
  const last = await prisma.trackPoint.findFirst({ where: { sessionId: session.id }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true, x: true, y: true, level: true } });
  const { kept, droppedJitter } = smoothTrack(candidates, last);
  dropped.jitter = droppedJitter;

  if (kept.length > 0) {
    await prisma.$transaction([
      prisma.trackPoint.createMany({
        data: kept.map((p) => ({ sessionId: session.id, recordedAt: p.recordedAt, x: p.x, y: p.y, level: p.level, floorId: p.floorId ?? null, accuracyM: p.accuracyM, routeId: p.routeId ?? null })),
      }),
      prisma.trackingSession.update({
        where: { id: session.id },
        data: { pointCount: { increment: kept.length }, lastPointAt: kept.at(-1)!.recordedAt },
      }),
    ]);
  }

  session = exitAt
    ? ((await endSession(session.id, 'GEOFENCE_EXIT', exitAt)) ?? session)
    : await applyAutoStop(await prisma.trackingSession.findUniqueOrThrow({ where: { id: session.id } }), now);

  return { accepted: kept.length, dropped, session: toStatusDto(session, now, lang) };
}

// ───────────── difficulty reports ─────────────

export type EventInput = {
  sessionId: string;
  type: 'BLOCKED' | 'TOO_STEEP' | 'HARD_TO_NAVIGATE';
  note?: string | undefined;
  x: number;
  y: number;
  level: number;
  floorId?: string | undefined;
  recordedAt?: Date | undefined;
  routeId?: string | undefined;
};

/** Nearest passage within 6 m on that level (stairs and elevators touching it included). */
export async function nearestEdge(x: number, y: number, level: number, maxM = 6): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM nav_edges e
    JOIN nav_nodes a ON a.id = e."fromId" JOIN nav_nodes b ON b.id = e."toId"
    WHERE (a.level = ${level} OR b.level = ${level}) AND ST_DWithin(e.geom, ST_MakePoint(${x}, ${y}), ${maxM})
    ORDER BY e.geom <-> ST_MakePoint(${x}, ${y}) LIMIT 1`;
  return rows[0]?.id ?? null;
}

export async function reportEvent(userId: string, input: EventInput, now: Date) {
  await assertConsent(userId);
  const session = await applyAutoStop(await ownedSession(userId, input.sessionId), now);
  if (session.endedAt) throw sessionEnded(session.endReason);
  const [inside] = await insideGeofence([input]);
  if (!inside) throw new HttpError(422, 'OUTSIDE_GEOFENCE', 'Reports are only accepted inside the campus');

  const recordedAt = input.recordedAt && input.recordedAt <= now && input.recordedAt >= session.startedAt ? input.recordedAt : now;
  const edgeId = await nearestEdge(input.x, input.y, input.level);
  const note = input.note ? redactNote(input.note) || null : null;
  const event = await prisma.difficultyEvent.create({
    data: {
      sessionId: session.id,
      type: input.type,
      mobility: session.mobility,
      level: input.level,
      floorId: input.floorId ?? null,
      edgeId,
      note,
      routeId: input.routeId ?? null,
      recordedAt,
      x: input.x,
      y: input.y,
    },
  });
  return { id: event.id, type: event.type, edgeId, recordedAt: event.recordedAt.toISOString() };
}

