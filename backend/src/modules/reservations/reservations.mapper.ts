import type { Reservation } from '@prisma/client';
import type { z } from 'zod';
import type { ReservationSchema } from './reservations.schemas.js';

export type ReservationDto = z.input<typeof ReservationSchema>;

export function toReservationDto(r: Reservation & { room: { code: string } }): ReservationDto {
  return {
    id: r.id,
    roomId: r.roomId,
    roomCode: r.room.code,
    kind: r.kind,
    title: r.title,
    organizer: r.organizer,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
  };
}
