import { z } from 'zod';
import { IdParam, IsoDateTime } from '../../openapi/schemas.js';

export const ReservationKindSchema = z
  .enum(['TEACHER', 'ADMIN', 'CLUB'])
  .meta({ id: 'ReservationKind', description: 'TEACHER/ADMIN show as red (lock), CLUB as orange (group)' });

export const ReservationSchema = z
  .object({
    id: z.string(),
    roomId: z.string(),
    roomCode: z.string(),
    kind: ReservationKindSchema,
    title: z.string(),
    organizer: z.string().describe('Shown as occupantName in room status'),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    ownerId: z.string().nullable().describe('User who created it; null for imported timetable entries'),
  })
  .meta({ id: 'Reservation' });

export const ReservationListSchema = z
  .object({ items: z.array(ReservationSchema), from: IsoDateTime, to: IsoDateTime })
  .meta({ id: 'ReservationList' });

/** Accepts any ISO-8601 instant with an offset (Z or +01:00). */
const Instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const CreateReservationBody = z
  .object({
    roomId: IdParam,
    kind: ReservationKindSchema.default('TEACHER'),
    title: z.string().trim().min(3).max(120),
    organizer: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .optional()
      .describe('Defaults to your display name. Required for CLUB reservations (club name). Teachers cannot set it on TEACHER reservations.'),
    startsAt: Instant,
    endsAt: Instant,
  })
  .strict()
  .meta({ id: 'CreateReservation' });

export const UpdateReservationBody = z
  .object({
    roomId: IdParam,
    title: z.string().trim().min(3).max(120),
    organizer: z.string().trim().min(2).max(80),
    startsAt: Instant,
    endsAt: Instant,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field')
  .meta({ id: 'UpdateReservation' });

export const ListReservationsQuery = z
  .object({
    roomId: IdParam.optional(),
    from: Instant.optional().describe('Default: start of today (Africa/Algiers)'),
    to: Instant.optional().describe('Default: from + 7 days. Max range 31 days.'),
    kind: ReservationKindSchema.optional(),
    mine: z.stringbool().optional().describe('Only reservations I created'),
  });

export const ReservationIdParams = z.object({ id: IdParam });
