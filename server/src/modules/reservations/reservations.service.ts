import { Prisma, type Reservation } from '@prisma/client';
import type { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import { prisma } from '../../lib/prisma.js';
import { algiersDayBounds } from '../../lib/time.js';
import type { AuthUser } from '../../middleware/auth.js';
import { findConflicts, intervalProblem, type Interval } from './overlap.js';
import { toReservationDto, type ReservationDto } from './reservations.mapper.js';
import type { CreateReservationBody, ListReservationsQuery, UpdateReservationBody } from './reservations.schemas.js';

const MAX_RANGE_MS = 31 * 86_400_000;
const WITH_ROOM = { room: { select: { code: true } } } as const;

type ReservationWithRoom = Reservation & { room: { code: string } };

function conflictError(conflicts: ReservationWithRoom[]): HttpError {
  return new HttpError(409, 'RESERVATION_CONFLICT', 'The room is already reserved during this time', {
    conflicts: conflicts.map(toReservationDto),
  });
}

function assertInterval(i: Interval, now: Date, checkPast: boolean): void {
  const problem = intervalProblem(i, now, checkPast);
  if (!problem) return;
  const messages = {
    END_BEFORE_START: 'endsAt must be after startsAt',
    TOO_SHORT: 'A reservation lasts at least 15 minutes',
    TOO_LONG: 'A reservation lasts at most 12 hours',
    IN_PAST: 'A reservation cannot start in the past',
  } as const;
  throw new HttpError(400, 'INVALID_INTERVAL', messages[problem], { problem });
}

/** The exclusion constraint fired: another request booked the same slot concurrently. */
function isOverlapViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const meta = (err as { meta?: { code?: unknown } }).meta;
  return err.message.includes('reservations_no_overlap') || err.message.includes('23P01') || meta?.code === '23P01';
}

/**
 * Locks the room row, checks overlaps, then writes, all in one transaction, so two
 * teachers booking the same slot get one 201 and one 409. The DB exclusion constraint
 * is the backstop if anything bypasses this path.
 */
async function writeWithoutConflict(
  roomId: string,
  interval: Interval,
  excludeId: string | undefined,
  write: (tx: Prisma.TransactionClient) => Promise<ReservationWithRoom>,
): Promise<ReservationWithRoom> {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`;
      if (locked.length === 0) throw new HttpError(404, 'ROOM_NOT_FOUND', `Room ${roomId} not found`);

      const candidates = await tx.reservation.findMany({
        where: { roomId, startsAt: { lt: interval.endsAt }, endsAt: { gt: interval.startsAt } },
        include: WITH_ROOM,
        orderBy: { startsAt: 'asc' },
      });
      const conflicts = findConflicts(interval, candidates, excludeId);
      if (conflicts.length > 0) throw conflictError(conflicts);
      return write(tx);
    });
  } catch (err) {
    if (isOverlapViolation(err)) {
      const conflicts = await prisma.reservation.findMany({
        where: { roomId, startsAt: { lt: interval.endsAt }, endsAt: { gt: interval.startsAt }, ...(excludeId ? { id: { not: excludeId } } : {}) },
        include: WITH_ROOM,
      });
      throw conflictError(conflicts);
    }
    throw err;
  }
}

async function loadOwned(id: string, user: AuthUser): Promise<ReservationWithRoom> {
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: WITH_ROOM });
  if (!reservation) throw HttpError.notFound(`Reservation ${id} not found`);
  if (user.role !== 'ADMIN' && reservation.userId !== user.id) {
    throw HttpError.forbidden('You can only change reservations you created');
  }
  return reservation;
}

export async function listReservations(q: z.output<typeof ListReservationsQuery>, user: AuthUser, now: Date): Promise<{ items: ReservationDto[]; from: string; to: string }> {
  const from = q.from ?? algiersDayBounds(now).start;
  const to = q.to ?? new Date(from.getTime() + 7 * 86_400_000);
  if (to <= from) throw HttpError.badRequest('"to" must be after "from"');
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw HttpError.badRequest('Range is limited to 31 days');

  const items = await prisma.reservation.findMany({
    where: {
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(q.roomId ? { roomId: q.roomId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.mine ? { userId: user.id } : {}),
    },
    include: WITH_ROOM,
    orderBy: [{ startsAt: 'asc' }, { roomId: 'asc' }],
    take: 1000,
  });
  return { items: items.map(toReservationDto), from: from.toISOString(), to: to.toISOString() };
}

export async function getReservation(id: string): Promise<ReservationDto> {
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: WITH_ROOM });
  if (!reservation) throw HttpError.notFound(`Reservation ${id} not found`);
  return toReservationDto(reservation);
}

export async function createReservation(input: z.output<typeof CreateReservationBody>, user: AuthUser, now: Date): Promise<ReservationDto> {
  if (input.kind === 'ADMIN' && user.role !== 'ADMIN') throw HttpError.forbidden('Only the administration can create ADMIN reservations');
  if (input.kind === 'TEACHER' && user.role !== 'TEACHER' && user.role !== 'ADMIN') throw HttpError.forbidden('Only teachers can create TEACHER reservations');

  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true } });
  if (!me) throw new HttpError(401, 'UNKNOWN_USER', 'This account no longer exists');

  let organizer = input.organizer ?? me.displayName;
  if (user.role === 'TEACHER' && input.kind === 'TEACHER') {
    if (input.organizer && input.organizer !== me.displayName) {
      throw HttpError.forbidden('Teaching sessions are always organised under your own name');
    }
    organizer = me.displayName;
  }
  if (input.kind === 'CLUB' && !input.organizer) {
    throw HttpError.badRequest('organizer (club name) is required for CLUB reservations');
  }

  const interval = { startsAt: input.startsAt, endsAt: input.endsAt };
  assertInterval(interval, now, true);

  const created = await writeWithoutConflict(input.roomId, interval, undefined, (tx) =>
    tx.reservation.create({
      data: { roomId: input.roomId, kind: input.kind, title: input.title, organizer, userId: user.id, ...interval },
      include: WITH_ROOM,
    }),
  );
  bus.emit('rooms.changed', { roomIds: [created.roomId] });
  return toReservationDto(created);
}

export async function updateReservation(
  id: string,
  input: z.output<typeof UpdateReservationBody>,
  user: AuthUser,
  now: Date,
): Promise<ReservationDto> {
  const existing = await loadOwned(id, user);
  if (existing.endsAt <= now) throw new HttpError(409, 'RESERVATION_ENDED', 'A reservation that has ended cannot be changed');
  if (input.organizer !== undefined && user.role === 'TEACHER' && existing.kind === 'TEACHER') {
    throw HttpError.forbidden('Teaching sessions are always organised under your own name');
  }

  const interval = { startsAt: input.startsAt ?? existing.startsAt, endsAt: input.endsAt ?? existing.endsAt };
  const startChanged = input.startsAt !== undefined && input.startsAt.getTime() !== existing.startsAt.getTime();
  assertInterval(interval, now, startChanged);
  if (interval.endsAt.getTime() <= now.getTime()) throw new HttpError(400, 'INVALID_INTERVAL', 'endsAt must be in the future', { problem: 'IN_PAST' });

  const roomId = input.roomId ?? existing.roomId;
  const updated = await writeWithoutConflict(roomId, interval, id, (tx) =>
    tx.reservation.update({
      where: { id },
      data: {
        roomId,
        ...interval,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.organizer !== undefined ? { organizer: input.organizer } : {}),
      },
      include: WITH_ROOM,
    }),
  );
  bus.emit('rooms.changed', { roomIds: [...new Set([existing.roomId, updated.roomId])] });
  return toReservationDto(updated);
}

export async function deleteReservation(id: string, user: AuthUser, now: Date): Promise<void> {
  const existing = await loadOwned(id, user);
  if (existing.endsAt <= now && user.role !== 'ADMIN') {
    throw new HttpError(409, 'RESERVATION_ENDED', 'Past reservations are kept as history');
  }
  await prisma.reservation.delete({ where: { id } });
  bus.emit('rooms.changed', { roomIds: [existing.roomId] });
}
