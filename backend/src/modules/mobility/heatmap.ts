/**
 * Heatmap aggregation: raw points → 2 m grid cells per period and category.
 * k-anonymity: a cell seen by fewer than K_MIN distinct daily pseudonyms is not
 * stored at all (a CHECK constraint guarantees it), and readers filter again.
 */
import type { PrismaClient } from '@prisma/client';
import { algiersDayBounds } from '../../lib/time.js';
import { CELL_SIZE_M, K_MIN } from './privacy.js';

export const PERIODS = ['TODAY', '7D', '30D'] as const;
export type Period = (typeof PERIODS)[number];

export function periodWindow(period: Period, now: Date): { start: Date; end: Date } {
  if (period === 'TODAY') return { start: algiersDayBounds(now).start, end: now };
  const days = period === '7D' ? 7 : 30;
  return { start: new Date(now.getTime() - days * 86_400_000), end: now };
}

/** Rebuilds one period. Segments: ALL, DISABILITY (any category but NONE) and each category. */
export async function recomputeHeatmap(db: PrismaClient, period: Period, now: Date, cellSizeM = CELL_SIZE_M): Promise<number> {
  const { start, end } = periodWindow(period, now);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM heatmap_cells WHERE period = ${period}`;
    return tx.$executeRaw`
      WITH pts AS (
        SELECT tp.level, floor(tp.x / ${cellSizeM})::int AS cx, floor(tp.y / ${cellSizeM})::int AS cy,
               s.id AS sid, s."pseudoId" AS pid, s.mobility::text AS mobility
        FROM track_points tp JOIN tracking_sessions s ON s.id = tp."sessionId"
        WHERE tp."recordedAt" >= ${start} AND tp."recordedAt" < ${end}
      ), seg AS (
        SELECT level, cx, cy, 'ALL'::text AS segment, sid, pid FROM pts
        UNION ALL SELECT level, cx, cy, 'DISABILITY', sid, pid FROM pts WHERE mobility <> 'NONE'
        UNION ALL SELECT level, cx, cy, mobility, sid, pid FROM pts
      ), agg AS (
        SELECT level, cx, cy, segment, count(DISTINCT sid)::int AS visits, count(DISTINCT pid)::int AS contributors
        FROM seg GROUP BY level, cx, cy, segment
      ), ev_raw AS (
        SELECT e.level, floor(e.x / ${cellSizeM})::int AS cx, floor(e.y / ${cellSizeM})::int AS cy,
               e.type::text AS type, e.mobility::text AS mobility, COALESCE(e."pseudoId", s."pseudoId") AS pid
        FROM difficulty_events e LEFT JOIN tracking_sessions s ON s.id = e."sessionId"
        WHERE e."recordedAt" >= ${start} AND e."recordedAt" < ${end}
      ), ev AS (
        SELECT level, cx, cy, segment, count(*)::int AS n,
               count(DISTINCT pid)::int AS contributors,
               (count(*) FILTER (WHERE type = 'STUCK'))::int AS stuck
        FROM (
          SELECT level, cx, cy, 'ALL'::text AS segment, type, pid FROM ev_raw
          UNION ALL SELECT level, cx, cy, 'DISABILITY', type, pid FROM ev_raw WHERE mobility <> 'NONE'
          UNION ALL SELECT level, cx, cy, mobility, type, pid FROM ev_raw
        ) e GROUP BY level, cx, cy, segment
      )
      INSERT INTO heatmap_cells (id, period, level, "cellSizeM", "cellX", "cellY", segment, "windowStart", "windowEnd",
                                 "visitCount", "contributorCount", "difficultyCount", "stuckCount", x, y, "computedAt")
      SELECT gen_random_uuid()::text, ${period}, a.level, ${cellSizeM}, a.cx, a.cy, a.segment, ${start}, ${end},
             a.visits, a.contributors,
             CASE WHEN ev.contributors >= ${K_MIN} THEN COALESCE(ev.n, 0) ELSE 0 END,
             CASE WHEN ev.contributors >= ${K_MIN} THEN COALESCE(ev.stuck, 0) ELSE 0 END,
             (a.cx + 0.5) * ${cellSizeM}, (a.cy + 0.5) * ${cellSizeM}, ${now}
      FROM agg a LEFT JOIN ev USING (level, cx, cy, segment)
      WHERE a.contributors >= ${K_MIN}`;
  });
}
