/** Reservation interval rules. Pure: no I/O. Intervals are half-open [startsAt, endsAt). */

export type Interval = { startsAt: Date; endsAt: Date };

/** True when the two intervals share at least one instant. Back-to-back is not an overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** Existing reservations that would collide with `candidate` (ignoring `excludeId`, i.e. itself on update). */
export function findConflicts<T extends Interval & { id: string }>(candidate: Interval, existing: readonly T[], excludeId?: string): T[] {
  return existing.filter((r) => r.id !== excludeId && overlaps(candidate, r));
}

export const MAX_DURATION_MS = 12 * 3_600_000;
export const MIN_DURATION_MS = 15 * 60_000;
/** Clock-skew tolerance for "not in the past". */
export const PAST_TOLERANCE_MS = 5 * 60_000;

export type IntervalProblem = 'END_BEFORE_START' | 'TOO_SHORT' | 'TOO_LONG' | 'IN_PAST';

/**
 * Validates an interval. `checkPast` is false when updating a reservation
 * without touching its start (e.g. extending a session already running).
 */
export function intervalProblem(i: Interval, now: Date, checkPast = true): IntervalProblem | null {
  const duration = i.endsAt.getTime() - i.startsAt.getTime();
  if (duration <= 0) return 'END_BEFORE_START';
  if (duration < MIN_DURATION_MS) return 'TOO_SHORT';
  if (duration > MAX_DURATION_MS) return 'TOO_LONG';
  if (checkPast && i.startsAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) return 'IN_PAST';
  return null;
}
