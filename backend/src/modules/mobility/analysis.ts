/**
 * Background job: runs the detectors on points received since the last pass and
 * records inferred difficulty events (detector column set, so they are never
 * confused with what students reported themselves).
 */
import { prisma } from '../../lib/prisma.js';
import { detectDwells, detectUTurns, repeatedUTurns, type TrackPoint } from './detectors.js';

/** Re-read a little before the last pass so episodes spanning two batches are seen whole. */
const OVERLAP_MS = 5 * 60_000;
const DEDUPE_RADIUS_M = 5;

/** In a room or within 4 m of a door / POI: a normal place to stay still. */
async function nearPlace(x: number, y: number, level: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ near: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM rooms r JOIN floors f ON f.id = r."floorId" WHERE f.level = ${level} AND ST_Covers(r.shape, ST_MakePoint(${x}, ${y})))
        OR EXISTS (SELECT 1 FROM pois WHERE level = ${level} AND ST_DWithin(geom, ST_MakePoint(${x}, ${y}), 4))
        OR EXISTS (SELECT 1 FROM nav_nodes WHERE level = ${level} AND kind = 'DOOR' AND ST_DWithin(geom, ST_MakePoint(${x}, ${y}), 4))
        AS near`;
  return rows[0]?.near ?? false;
}

/** Nearest obstacle within 6 m: stairs/steps, ramp steeper than 8 %, closed or narrow (< 80 cm) passage. */
async function obstacleNear(x: number, y: number, level: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM nav_edges e
    JOIN nav_nodes a ON a.id = e."fromId" JOIN nav_nodes b ON b.id = e."toId"
    WHERE (a.level = ${level} OR b.level = ${level})
      AND (e."hasStairs" OR (e."isRamp" AND e."slopePercent" > 8) OR NOT e."isOpen" OR LEAST(e."widthCm", COALESCE(e."doorClearanceCm", e."widthCm")) < 80)
      AND ST_DWithin(e.geom, ST_MakePoint(${x}, ${y}), 6)
    ORDER BY e.geom <-> ST_MakePoint(${x}, ${y}) LIMIT 1`;
  return rows[0]?.id ?? null;
}

async function alreadyRecorded(sessionId: string, detector: string, x: number, y: number, since: Date): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM difficulty_events WHERE "sessionId" = ${sessionId} AND detector = ${detector}
      AND "recordedAt" >= ${since} AND ST_DWithin(geom, ST_MakePoint(${x}, ${y}), ${DEDUPE_RADIUS_M})) AS found`;
  return rows[0]?.found ?? false;
}

export type DetectionSummary = { sessions: number; stuck: number; rerouted: number; repeatedUTurns: number };

export async function runDetectors(now: Date, limit = 200): Promise<DetectionSummary> {
  const summary: DetectionSummary = { sessions: 0, stuck: 0, rerouted: 0, repeatedUTurns: 0 };
  const sessions = await prisma.$queryRaw<{ id: string; pseudoId: string; mobility: string; analyzedUntil: Date | null; lastPointAt: Date }[]>`
    SELECT id, "pseudoId", mobility::text AS mobility, "analyzedUntil", "lastPointAt" FROM tracking_sessions
    WHERE "lastPointAt" IS NOT NULL AND ("analyzedUntil" IS NULL OR "lastPointAt" > "analyzedUntil")
    ORDER BY "lastPointAt" LIMIT ${limit}`;

  for (const s of sessions) {
    summary.sessions += 1;
    const since = s.analyzedUntil ?? new Date(0);
    const points: TrackPoint[] = await prisma.trackPoint.findMany({
      where: { sessionId: s.id, recordedAt: { gte: new Date(since.getTime() - OVERLAP_MS) } },
      orderBy: { recordedAt: 'asc' },
      select: { recordedAt: true, x: true, y: true, level: true },
    });
    const mobility = s.mobility as never;
    const isNew = (t: Date) => t.getTime() > since.getTime();

    for (const d of detectDwells(points)) {
      if (!isNew(d.end) || (await nearPlace(d.x, d.y, d.level))) continue;
      if (await alreadyRecorded(s.id, 'DWELL', d.x, d.y, new Date(d.start.getTime() - OVERLAP_MS))) continue;
      await prisma.difficultyEvent.create({
        data: { sessionId: s.id, pseudoId: s.pseudoId, type: 'STUCK', detector: 'DWELL', mobility, level: d.level, x: d.x, y: d.y, recordedAt: d.end, edgeId: await obstacleNear(d.x, d.y, d.level), note: null },
      });
      summary.stuck += 1;
    }

    const turns = detectUTurns(points).filter((t) => isNew(t.at));
    const grouped = new Set<object>();
    for (const group of repeatedUTurns(turns)) {
      group.forEach((t) => grouped.add(t));
      const x = group.reduce((a, t) => a + t.x, 0) / group.length;
      const y = group.reduce((a, t) => a + t.y, 0) / group.length;
      if (await alreadyRecorded(s.id, 'REPEATED_U_TURNS', x, y, new Date(group[0]!.at.getTime() - OVERLAP_MS))) continue;
      await prisma.difficultyEvent.create({
        data: { sessionId: s.id, pseudoId: s.pseudoId, type: 'HARD_TO_NAVIGATE', detector: 'REPEATED_U_TURNS', mobility, level: group[0]!.level, x, y, recordedAt: group.at(-1)!.at, note: null },
      });
      summary.repeatedUTurns += 1;
    }
    for (const t of turns) {
      if (grouped.has(t)) continue;
      const edgeId = await obstacleNear(t.x, t.y, t.level);
      if (!edgeId || (await alreadyRecorded(s.id, 'U_TURN_AT_OBSTACLE', t.x, t.y, new Date(t.at.getTime() - OVERLAP_MS)))) continue;
      await prisma.difficultyEvent.create({
        data: { sessionId: s.id, pseudoId: s.pseudoId, type: 'REROUTED', detector: 'U_TURN_AT_OBSTACLE', mobility, level: t.level, x: t.x, y: t.y, recordedAt: t.at, edgeId, note: null },
      });
      summary.rerouted += 1;
    }

    await prisma.trackingSession.update({ where: { id: s.id }, data: { analyzedUntil: s.lastPointAt } });
  }
  return summary;
}
