/**
 * Campus time helpers. Algeria (Africa/Algiers) is UTC+1 all year, with no DST,
 * so a fixed offset is exact and avoids pulling in a timezone library.
 */
export const ALGIERS_OFFSET_MIN = 60;
const DAY_MS = 86_400_000;

/** Local calendar day (Africa/Algiers) as YYYY-MM-DD. */
export function algiersDayKey(date: Date): string {
  return new Date(date.getTime() + ALGIERS_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** UTC instant for a local Algiers wall-clock time on a given day. */
export function algiersTime(dayKey: string, hours: number, minutes = 0): Date {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, hours, minutes) - ALGIERS_OFFSET_MIN * 60_000);
}

/** [start, end) of the local Algiers day containing `date`. */
export function algiersDayBounds(date: Date): { start: Date; end: Date } {
  const start = algiersTime(algiersDayKey(date), 0, 0);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}
