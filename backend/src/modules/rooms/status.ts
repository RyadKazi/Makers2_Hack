/**
 * Live room status, computed from reservations at a given instant. Pure: no I/O.
 *
 *   AVAILABLE  nothing running now. `until` = start of the next reservation (null = free
 *              for the rest of the window), `freeAt` = now.
 *   TEACHER /  a reservation of that kind is running. `until` = its end,
 *   ADMIN /    `freeAt` = when the room is actually free again, following
 *   CLUB       back-to-back reservations (e.g. two consecutive sessions).
 *
 * Intervals are half-open [startsAt, endsAt): a session ending at 09:30 and
 * one starting at 09:30 do not overlap, and at 09:30 the second one is running.
 */
import type { Lang } from '../../lib/i18n.js';

export const ROOM_STATUSES = ['AVAILABLE', 'TEACHER', 'ADMIN', 'CLUB'] as const;
export type RoomStatusCode = (typeof ROOM_STATUSES)[number];
export type ReservationKind = Exclude<RoomStatusCode, 'AVAILABLE'>;

export type ReservationSlot = {
  id: string;
  kind: ReservationKind;
  title: string;
  organizer: string;
  startsAt: Date;
  endsAt: Date;
};

export type RoomStatus = {
  status: RoomStatusCode;
  occupantName: string | null;
  title: string | null;
  reservationId: string | null;
  until: Date | null;
  freeAt: Date;
};

/** When two reservations wrongly overlap, the more authoritative one is shown. */
const PRIORITY: Record<ReservationKind, number> = { ADMIN: 0, TEACHER: 1, CLUB: 2 };

export function isRunning(r: Pick<ReservationSlot, 'startsAt' | 'endsAt'>, now: Date): boolean {
  return r.startsAt.getTime() <= now.getTime() && now.getTime() < r.endsAt.getTime();
}

export function computeRoomStatus(reservations: readonly ReservationSlot[], now: Date): RoomStatus {
  const t = now.getTime();
  const sorted = [...reservations].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const current = sorted.filter((r) => isRunning(r, now)).sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])[0];

  if (!current) {
    const next = sorted.find((r) => r.startsAt.getTime() > t);
    return { status: 'AVAILABLE', occupantName: null, title: null, reservationId: null, until: next?.startsAt ?? null, freeAt: now };
  }

  // Follow back-to-back (or overlapping) reservations to find when the room is really free.
  let freeAt = current.endsAt.getTime();
  for (const r of sorted) {
    if (r.startsAt.getTime() <= freeAt && r.endsAt.getTime() > freeAt) freeAt = r.endsAt.getTime();
  }

  return {
    status: current.kind,
    occupantName: current.organizer,
    title: current.title,
    reservationId: current.id,
    until: current.endsAt,
    freeAt: new Date(freeAt),
  };
}

const LABELS: Record<Lang, Record<RoomStatusCode, string>> = {
  fr: { AVAILABLE: 'Disponible', TEACHER: 'Occupée — enseignant', ADMIN: 'Occupée — administration', CLUB: 'Occupée — club' },
  en: { AVAILABLE: 'Available', TEACHER: 'Occupied — teacher', ADMIN: 'Occupied — administration', CLUB: 'Occupied — club' },
  ar: { AVAILABLE: 'متاحة', TEACHER: 'مشغولة — أستاذ', ADMIN: 'مشغولة — الإدارة', CLUB: 'مشغولة — نادٍ' },
};

export function statusLabel(status: RoomStatusCode, lang: Lang): string {
  return LABELS[lang][status];
}

/** Wire format (see RoomStatusSchema). */
export function toRoomStatusDto(s: RoomStatus, lang: Lang) {
  return {
    status: s.status,
    label: statusLabel(s.status, lang),
    occupantName: s.occupantName,
    title: s.title,
    reservationId: s.reservationId,
    until: s.until?.toISOString() ?? null,
    freeAt: s.freeAt.toISOString(),
  };
}
