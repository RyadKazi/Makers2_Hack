import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import type { Lang } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { algiersDayBounds } from '../../lib/time.js';
import { toReservationDto } from '../reservations/reservations.mapper.js';
import { distancesFrom, type RouteConstraints } from '../routing/graph.js';
import { getCampusGraph, reachableFromEntrances, type CampusGraph } from '../routing/graph.repository.js';
import type { ListRoomsQuery, NearbyPoiSchema, RoomDetailSchema, RoomListSchema, RoomSummarySchema } from './rooms.schemas.js';
import { computeRoomStatus, toRoomStatusDto, type ReservationSlot, type RoomStatus } from './status.js';

const ROOM_INCLUDE = { floor: { include: { building: true } } } satisfies Prisma.RoomInclude;
type RoomRow = Prisma.RoomGetPayload<{ include: typeof ROOM_INCLUDE }>;

type RoomSummaryDto = z.input<typeof RoomSummarySchema>;
type NearbyPoiDto = z.input<typeof NearbyPoiSchema>;

/** Baseline used for the room's "wheelchair accessible" flag (individual profiles may be stricter). */
export const WHEELCHAIR_BASELINE: RouteConstraints = { stepFree: true, maxSlopePercent: 8, minWidthCm: 80 };

const SLOT_SELECT = { id: true, roomId: true, kind: true, title: true, organizer: true, startsAt: true, endsAt: true } as const;

/** How far ahead "available until" looks. Rolling, so it stays meaningful around midnight. */
export const STATUS_LOOKAHEAD_MS = 24 * 3_600_000;

/** Reservations that matter for the status at `now`: running now, or starting within the lookahead. */
function statusWindow(now: Date): Prisma.ReservationWhereInput {
  return { endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + STATUS_LOOKAHEAD_MS) } };
}

/** Live status of each room (all rooms when `roomIds` is omitted). */
export async function statusesByRoom(roomIds: readonly string[] | undefined, now: Date): Promise<Map<string, RoomStatus>> {
  const slots = await prisma.reservation.findMany({
    where: { ...statusWindow(now), ...(roomIds ? { roomId: { in: [...roomIds] } } : {}) },
    select: SLOT_SELECT,
  });
  const byRoom = new Map<string, ReservationSlot[]>();
  for (const s of slots) {
    const list = byRoom.get(s.roomId);
    if (list) list.push(s);
    else byRoom.set(s.roomId, [s]);
  }
  const ids = roomIds ?? (await prisma.room.findMany({ select: { id: true } })).map((r) => r.id);
  return new Map(ids.map((id) => [id, computeRoomStatus(byRoom.get(id) ?? [], now)]));
}

type AccessSets = { stepFree: Set<string>; wheelchair: Set<string> };

function accessSets(graph: CampusGraph): AccessSets {
  return {
    stepFree: reachableFromEntrances(graph, { stepFree: true }),
    wheelchair: reachableFromEntrances(graph, WHEELCHAIR_BASELINE),
  };
}

function toSummary(room: RoomRow, status: RoomStatus, access: AccessSets, lang: Lang): RoomSummaryDto {
  const b = room.floor.building;
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    nameAr: room.nameAr,
    type: room.type,
    capacity: room.capacity,
    wheelchairSpaces: room.wheelchairSpaces,
    hearingLoop: room.hearingLoop,
    building: { id: b.id, code: b.code, name: b.name, nameAr: b.nameAr },
    floor: { id: room.floor.id, level: room.floor.level, name: room.floor.name },
    x: room.x,
    y: room.y,
    stepFreeAccess: room.doorNodeId !== null && access.stepFree.has(room.doorNodeId),
    status: toRoomStatusDto(status, lang),
  };
}

export async function listRooms(q: z.output<typeof ListRoomsQuery>, now: Date, lang: Lang): Promise<z.input<typeof RoomListSchema>> {
  const where: Prisma.RoomWhereInput = {};
  if (q.buildingId !== undefined || q.floor !== undefined) {
    where.floor = { ...(q.buildingId !== undefined ? { buildingId: q.buildingId } : {}), ...(q.floor !== undefined ? { level: q.floor } : {}) };
  }
  if (q.minCapacity !== undefined) where.capacity = { gte: q.minCapacity };
  if (q.search) {
    const contains = { contains: q.search, mode: 'insensitive' } as const;
    where.OR = [
      { code: contains },
      { name: contains },
      { nameAr: contains },
      { floor: { building: { OR: [{ name: contains }, { nameAr: contains }, { code: { equals: q.search, mode: 'insensitive' } }] } } },
    ];
  }

  const rooms = await prisma.room.findMany({ where, include: ROOM_INCLUDE, orderBy: { code: 'asc' } });
  const [statuses, graph] = await Promise.all([statusesByRoom(rooms.map((r) => r.id), now), getCampusGraph()]);
  const access = accessSets(graph);

  let items = rooms.map((room) => toSummary(room, statuses.get(room.id)!, access, lang));
  if (q.status) items = items.filter((r) => q.status!.includes(r.status.status));
  if (q.stepFree !== undefined) items = items.filter((r) => r.stepFreeAccess === q.stepFree);

  return { items: items.slice(q.offset, q.offset + q.limit), total: items.length, at: now.toISOString() };
}

async function findRoom(idOrCode: string): Promise<RoomRow> {
  const room = await prisma.room.findFirst({ where: { OR: [{ id: idOrCode }, { code: idOrCode }] }, include: ROOM_INCLUDE });
  if (!room) throw HttpError.notFound(`Room ${idOrCode} not found`);
  return room;
}

async function nearestPois(graph: CampusGraph, doorNodeId: string | null): Promise<{ elevator: NearbyPoiDto | null; accessibleToilet: NearbyPoiDto | null }> {
  if (!doorNodeId) return { elevator: null, accessibleToilet: null };
  const distances = distancesFrom(graph.edges, doorNodeId, { stepFree: true });
  const pois = await prisma.poi.findMany({
    where: { type: { in: ['ELEVATOR', 'ACCESSIBLE_TOILET'] }, navNodeId: { not: null } },
    include: { floor: { select: { building: { select: { code: true } } } } },
  });

  const best = (type: 'ELEVATOR' | 'ACCESSIBLE_TOILET'): NearbyPoiDto | null => {
    let winner: NearbyPoiDto | null = null;
    for (const p of pois) {
      if (p.type !== type || !p.navNodeId) continue;
      const d = distances.get(p.navNodeId);
      if (d === undefined || (winner && d >= winner.routeDistanceM)) continue;
      winner = {
        id: p.id,
        type: p.type,
        name: p.name,
        nameAr: p.nameAr,
        level: p.level,
        floorId: p.floorId,
        buildingCode: p.floor?.building.code ?? null,
        x: p.x,
        y: p.y,
        routeDistanceM: Math.round(d * 10) / 10,
      };
    }
    return winner;
  };
  return { elevator: best('ELEVATOR'), accessibleToilet: best('ACCESSIBLE_TOILET') };
}

export async function getRoom(idOrCode: string, now: Date, lang: Lang): Promise<z.input<typeof RoomDetailSchema>> {
  const room = await findRoom(idOrCode);
  const day = algiersDayBounds(now);
  const [todays, upcoming, graph] = await Promise.all([
    prisma.reservation.findMany({
      where: { roomId: room.id, endsAt: { gt: day.start }, startsAt: { lt: day.end } },
      include: { room: { select: { code: true } } },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.reservation.findMany({ where: { roomId: room.id, ...statusWindow(now) }, select: SLOT_SELECT }),
    getCampusGraph(),
  ]);
  const access = accessSets(graph);
  const status = computeRoomStatus(upcoming, now);

  const doorEdges = room.doorNodeId ? graph.edges.filter((e) => e.fromId === room.doorNodeId || e.toId === room.doorNodeId) : [];
  const clearances = doorEdges.map((e) => e.doorClearanceCm).filter((c): c is number => c !== null);
  const summary = toSummary(room, status, access, lang);

  return {
    ...summary,
    schedule: todays.map(toReservationDto),
    accessibility: {
      stepFreeAccess: summary.stepFreeAccess,
      wheelchairAccessible: room.doorNodeId !== null && access.wheelchair.has(room.doorNodeId),
      doorClearanceCm: clearances.length ? Math.min(...clearances) : null,
      wheelchairSpaces: room.wheelchairSpaces,
      hearingLoop: room.hearingLoop,
    },
    nearest: await nearestPois(graph, room.doorNodeId),
  };
}

/** Payloads for the `room:status` socket event. */
export async function roomStatusEvents(where: { roomIds: readonly string[] } | { floorId: string }, now: Date) {
  const rooms = await prisma.room.findMany({
    where: 'roomIds' in where ? { id: { in: [...where.roomIds] } } : { floorId: where.floorId },
    select: { id: true, code: true, floorId: true },
  });
  const statuses = await statusesByRoom(
    rooms.map((r) => r.id),
    now,
  );
  return rooms.map((r) => ({ roomId: r.id, code: r.code, floorId: r.floorId, status: statuses.get(r.id)! }));
}
