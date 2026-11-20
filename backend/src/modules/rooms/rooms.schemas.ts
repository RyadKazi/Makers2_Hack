import { z } from 'zod';
import { LangSchema } from '../../lib/i18n.js';
import { IdParam, IsoDateTime } from '../../openapi/schemas.js';
import { ReservationSchema } from '../reservations/reservations.schemas.js';
import { ROOM_STATUSES } from './status.js';

export const RoomStatusCodeSchema = z.enum(ROOM_STATUSES).meta({
  id: 'RoomStatusCode',
  description: 'AVAILABLE = green/check/solid · TEACHER, ADMIN = red/lock/stripes · CLUB = orange/group/dots',
});

export const RoomStatusSchema = z
  .object({
    status: RoomStatusCodeSchema,
    label: z.string().describe('Localised label (?lang= or Accept-Language)'),
    occupantName: z.string().nullable().describe('Teacher, service or club currently using the room'),
    title: z.string().nullable().describe('Current session title'),
    reservationId: z.string().nullable(),
    until: IsoDateTime.nullable().describe('Occupied: end of the current reservation. Available: start of the next one within 24 h (null = free for the next 24 h).'),
    freeAt: IsoDateTime.describe('When the room is actually free, following back-to-back reservations (= now when available)'),
  })
  .meta({ id: 'RoomStatus' });

export const RoomTypeSchema = z.enum(['CLASSROOM', 'LAB', 'AMPHITHEATER', 'LIBRARY', 'OFFICE', 'MEETING']).meta({ id: 'RoomType' });

const BuildingRef = z.object({ id: z.string(), code: z.string(), name: z.string(), nameAr: z.string() }).meta({ id: 'BuildingRef' });
const FloorRef = z.object({ id: z.string(), level: z.number().int(), name: z.string() }).meta({ id: 'FloorRef' });

export const RoomSummarySchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    nameAr: z.string().nullable(),
    type: RoomTypeSchema,
    capacity: z.number().int(),
    wheelchairSpaces: z.number().int(),
    hearingLoop: z.boolean(),
    building: BuildingRef,
    floor: FloorRef,
    x: z.number(),
    y: z.number(),
    stepFreeAccess: z.boolean().describe('Reachable from the campus gate without any step, through open passages'),
    status: RoomStatusSchema,
  })
  .meta({ id: 'RoomSummary' });

export const RoomListSchema = z
  .object({
    items: z.array(RoomSummarySchema),
    total: z.number().int().describe('Matches before pagination'),
    at: IsoDateTime.describe('Instant the statuses were computed for'),
  })
  .meta({ id: 'RoomList' });

export const NearbyPoiSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    nameAr: z.string().nullable(),
    level: z.number().int(),
    floorId: z.string().nullable(),
    buildingCode: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    routeDistanceM: z.number().describe('Step-free walking distance from the room door'),
  })
  .meta({ id: 'NearbyPoi' });

export const RoomDetailSchema = RoomSummarySchema.extend({
  schedule: z.array(ReservationSchema.omit({ title: true, organizer: true })).describe("Today's reservations (Africa/Algiers), with personal titles and organizers omitted"),
  accessibility: z.object({
    stepFreeAccess: z.boolean(),
    wheelchairAccessible: z.boolean().describe('Step-free, slope ≤ 8 %, every passage and the door ≥ 80 cm'),
    doorClearanceCm: z.number().int().nullable(),
    wheelchairSpaces: z.number().int(),
    hearingLoop: z.boolean(),
  }),
  nearest: z.object({
    elevator: NearbyPoiSchema.nullable(),
    accessibleToilet: NearbyPoiSchema.nullable(),
  }),
}).meta({ id: 'RoomDetail' });

const StatusFilter = z
  .string()
  .regex(/^(AVAILABLE|TEACHER|ADMIN|CLUB)(,(AVAILABLE|TEACHER|ADMIN|CLUB))*$/, 'Comma-separated list of AVAILABLE, TEACHER, ADMIN, CLUB')
  .transform((s) => s.split(',') as (typeof ROOM_STATUSES)[number][]);

export const ListRoomsQuery = z
  .object({
    search: z.string().trim().min(1).max(80).optional().describe('Code, name (FR/AR) or building'),
    status: StatusFilter.optional().describe('e.g. AVAILABLE or TEACHER,ADMIN'),
    buildingId: IdParam.optional(),
    floor: z.coerce.number().int().min(-5).max(50).optional().describe('Floor level (0 = ground floor)'),
    minCapacity: z.coerce.number().int().min(1).max(2000).optional(),
    stepFree: z.stringbool().optional().describe('true: only rooms reachable without steps'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    lang: LangSchema.optional(),
  });

export const RoomParams = z.object({ id: IdParam.describe('Room id or code (e.g. A-104)') });
export const LangQuery = z.object({ lang: LangSchema.optional() });
