/**
 * Jitter smoothing for indoor positioning. Pure: no I/O.
 *
 * 1. Speed gate: a point implying more than MAX_SPEED_MS from the previous kept point
 *    on the same level is a positioning jump and is dropped.
 * 2. Accuracy-weighted exponential smoothing: x' = prev + α (x − prev), with
 *    α = clamp(3 m / accuracy, 0.35, 1). A 3 m fix is trusted fully, a 10 m fix only 35 %.
 *    Smoothing restarts after a level change or a gap longer than 30 s.
 */

export type RawPoint = { recordedAt: Date; x: number; y: number; level: number; floorId?: string | null; accuracyM: number; routeId?: string | null };
export type SmoothedPoint = RawPoint;
export type Anchor = { recordedAt: Date; x: number; y: number; level: number } | null;

/** Brisk walking is ~2 m/s; anything far above is a positioning jump. */
export const MAX_SPEED_MS = 3;
const RESET_GAP_MS = 30_000;

export function smoothingFactor(accuracyM: number): number {
  return Math.min(1, Math.max(0.35, 3 / Math.max(accuracyM, 0.1)));
}

export function smoothTrack(points: readonly RawPoint[], previous: Anchor = null): { kept: SmoothedPoint[]; droppedJitter: number } {
  const kept: SmoothedPoint[] = [];
  let prev = previous;
  let droppedJitter = 0;

  for (const p of points) {
    if (!prev || prev.level !== p.level || p.recordedAt.getTime() - prev.recordedAt.getTime() > RESET_GAP_MS) {
      const point = { ...p };
      kept.push(point);
      prev = point;
      continue;
    }
    const dt = (p.recordedAt.getTime() - prev.recordedAt.getTime()) / 1000;
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (dt <= 0 || d / dt > MAX_SPEED_MS) {
      droppedJitter += 1;
      continue;
    }
    const a = smoothingFactor(p.accuracyM);
    const point = { ...p, x: round(prev.x + a * (p.x - prev.x)), y: round(prev.y + a * (p.y - prev.y)) };
    kept.push(point);
    prev = point;
  }
  return { kept, droppedJitter };
}

const round = (n: number): number => Math.round(n * 100) / 100;
