/** Room status wording, filters and sorting. Pure (translation function injected). */
import type { RoomStatus, RoomStatusCode, RoomSummary } from '@/api/types';
import { formatTime } from '@/lib/format';
import type { Lang } from '@/stores/preferences';

type T = (key: string, opts?: Record<string, unknown>) => string;

/** "Available · until 14:00", "Occupied — teacher · until 15:30". */
export function statusLine(status: RoomStatus, t: T, lang: Lang, now = new Date()): string {
  if (!status.until) return status.status === 'AVAILABLE' ? `${status.label} · ${t('time.restOfDay')}` : status.label;
  return `${status.label} · ${t('time.until', { time: formatTime(status.until, lang, now) })}`;
}

/** The "Free" column: "Free now, until 14:00" / "Free at 16:00". */
export function freeText(status: RoomStatus, t: T, lang: Lang, now = new Date()): string {
  if (status.status === 'AVAILABLE') return status.until ? t('time.freeUntil', { time: formatTime(status.until, lang, now) }) : t('time.freeAllDay');
  return t('time.freeAt', { time: formatTime(status.freeAt, lang, now) });
}

export type StatusFilter = 'all' | 'available' | 'teacher' | 'occupied' | 'club';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'available', 'teacher', 'occupied', 'club'];

/** Server `status` query parameter for a filter. */
export function statusParam(f: StatusFilter): string | undefined {
  return { all: undefined, available: 'AVAILABLE', teacher: 'TEACHER', occupied: 'ADMIN', club: 'CLUB' }[f];
}

export type SortKey = 'code' | 'capacity' | 'free' | 'status';
export const SORT_KEYS: readonly SortKey[] = ['code', 'capacity', 'free', 'status'];

const STATUS_ORDER: Record<RoomStatusCode, number> = { AVAILABLE: 0, CLUB: 1, TEACHER: 2, ADMIN: 3 };

/** Natural code order: A-2 before A-10, "A-BIB" after numbers. */
const byCode = (a: RoomSummary, b: RoomSummary): number => a.code.localeCompare(b.code, 'en', { numeric: true });

export function sortRooms(rooms: readonly RoomSummary[], key: SortKey, now = new Date()): RoomSummary[] {
  const freeAt = (r: RoomSummary) => (r.status.status === 'AVAILABLE' ? now.getTime() : new Date(r.status.freeAt).getTime());
  const cmp: Record<SortKey, (a: RoomSummary, b: RoomSummary) => number> = {
    code: byCode,
    capacity: (a, b) => b.capacity - a.capacity || byCode(a, b),
    free: (a, b) => freeAt(a) - freeAt(b) || byCode(a, b),
    status: (a, b) => STATUS_ORDER[a.status.status] - STATUS_ORDER[b.status.status] || byCode(a, b),
  };
  return [...rooms].sort(cmp[key]);
}

export function filterByCapacity(rooms: readonly RoomSummary[], min?: number, max?: number): RoomSummary[] {
  return rooms.filter((r) => (min === undefined || r.capacity >= min) && (max === undefined || r.capacity <= max));
}

export function paginate<X>(items: readonly X[], page: number, size: number): { items: X[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages };
}
