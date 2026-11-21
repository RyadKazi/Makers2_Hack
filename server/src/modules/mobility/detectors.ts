/**
 * Behaviour detectors on a session's (smoothed) track. Pure: no I/O.
 *
 *   STUCK        dwell > 90 s within a 3 m radius. (The job then ignores dwells in rooms or
 *                next to POIs: waiting in class or at the toilet is not being stuck.)
 *   U-turn       heading reverses (> 150°) between two consecutive legs of ≥ 5 m.
 *   REROUTED     a U-turn next to an obstacle (stairs, steep ramp, closed or narrow passage).
 *   Repeated U-turns: ≥ 2 within 60 s and 20 m → HARD_TO_NAVIGATE (disorientation).
 */

export type TrackPoint = { recordedAt: Date; x: number; y: number; level: number };

export type Dwell = { level: number; x: number; y: number; start: Date; end: Date; durationS: number };
export type UTurn = { level: number; x: number; y: number; at: Date };

export const STUCK_RADIUS_M = 3;
export const STUCK_MIN_DWELL_S = 90;
export const UTURN_LEG_M = 5;
export const UTURN_ANGLE_DEG = 150;
export const REPEAT_WINDOW_S = 60;
export const REPEAT_RADIUS_M = 20;

export function detectDwells(points: readonly TrackPoint[], radiusM = STUCK_RADIUS_M, minDwellS = STUCK_MIN_DWELL_S): Dwell[] {
  const dwells: Dwell[] = [];
  let i = 0;
  while (i < points.length) {
    const first = points[i]!;
    let sx = first.x;
    let sy = first.y;
    let n = 1;
    let j = i + 1;
    while (j < points.length) {
      const p = points[j]!;
      if (p.level !== first.level || Math.hypot(p.x - sx / n, p.y - sy / n) > radiusM) break;
      sx += p.x;
      sy += p.y;
      n += 1;
      j += 1;
    }
    const last = points[j - 1]!;
    const durationS = (last.recordedAt.getTime() - first.recordedAt.getTime()) / 1000;
    if (durationS >= minDwellS) {
      dwells.push({ level: first.level, x: round(sx / n), y: round(sy / n), start: first.recordedAt, end: last.recordedAt, durationS: Math.round(durationS) });
      i = j;
    } else {
      i += 1;
    }
  }
  return dwells;
}

/** Simplifies the track into vertices at least `legM` apart (same level), then finds direction reversals. */
export function detectUTurns(points: readonly TrackPoint[], legM = UTURN_LEG_M, angleDeg = UTURN_ANGLE_DEG): UTurn[] {
  const turns: UTurn[] = [];
  let vertices: TrackPoint[] = [];
  const flush = () => {
    for (let k = 1; k + 1 < vertices.length; k += 1) {
      const a = vertices[k - 1]!;
      const b = vertices[k]!;
      const c = vertices[k + 1]!;
      const h1 = Math.atan2(b.y - a.y, b.x - a.x);
      const h2 = Math.atan2(c.y - b.y, c.x - b.x);
      let delta = Math.abs(((h2 - h1) * 180) / Math.PI) % 360;
      if (delta > 180) delta = 360 - delta;
      if (delta >= angleDeg) turns.push({ level: b.level, x: b.x, y: b.y, at: b.recordedAt });
    }
    vertices = [];
  };
  for (const p of points) {
    const last = vertices.at(-1);
    if (last && last.level !== p.level) flush();
    const prev = vertices.at(-1);
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= legM) vertices.push(p);
  }
  flush();
  return turns;
}

/** Groups U-turns that happen close together in time and space. */
export function repeatedUTurns(turns: readonly UTurn[], windowS = REPEAT_WINDOW_S, radiusM = REPEAT_RADIUS_M): UTurn[][] {
  const groups: UTurn[][] = [];
  for (const t of turns) {
    const g = groups.at(-1);
    const head = g?.[0];
    if (g && head && head.level === t.level && (t.at.getTime() - head.at.getTime()) / 1000 <= windowS && Math.hypot(t.x - head.x, t.y - head.y) <= radiusM) g.push(t);
    else groups.push([t]);
  }
  return groups.filter((g) => g.length >= 2);
}

const round = (n: number): number => Math.round(n * 100) / 100;
