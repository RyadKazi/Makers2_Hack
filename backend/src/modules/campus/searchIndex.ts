/**
 * Compact public index for client-side fuzzy search (Ctrl+K): rooms, buildings,
 * floors, points of interest and clubs (from upcoming CLUB reservations).
 * A few kilobytes for the whole campus; the client normalises AR / FR / EN text.
 */
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { IsoDateTime } from '../../openapi/schemas.js';
import { RoomTypeSchema } from '../rooms/rooms.schemas.js';

export const SearchIndexSchema = z
  .object({
    generatedAt: IsoDateTime,
    buildings: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        nameAr: z.string(),
        floors: z.array(z.object({ id: z.string(), level: z.number().int(), name: z.string() })),
      }),
    ),
    rooms: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        nameAr: z.string().nullable(),
        type: RoomTypeSchema,
        buildingCode: z.string(),
        floorId: z.string(),
        level: z.number().int(),
      }),
    ),
    pois: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        name: z.string(),
        nameAr: z.string().nullable(),
        floorId: z.string().nullable(),
        level: z.number().int(),
        buildingCode: z.string().nullable(),
        x: z.number(),
        y: z.number(),
      }),
    ),
    clubs: z.array(
      z.object({
        name: z.string(),
        roomCode: z.string(),
        floorId: z.string(),
        title: z.string(),
        startsAt: IsoDateTime,
        endsAt: IsoDateTime,
      }),
    ),
  })
  .meta({ id: 'SearchIndex', description: 'Everything searchable, for instant client-side fuzzy search.' });

const CLUB_HORIZON_MS = 7 * 86_400_000;

export async function buildSearchIndex(now: Date): Promise<z.input<typeof SearchIndexSchema>> {
  const [buildings, rooms, pois, clubSessions] = await Promise.all([
    prisma.building.findMany({ orderBy: { code: 'asc' }, include: { floors: { orderBy: { level: 'asc' }, select: { id: true, level: true, name: true } } } }),
    prisma.room.findMany({ orderBy: { code: 'asc' }, include: { floor: { select: { level: true, building: { select: { code: true } } } } } }),
    prisma.poi.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }], include: { floor: { select: { building: { select: { code: true } } } } } }),
    prisma.reservation.findMany({
      where: { kind: 'CLUB', endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + CLUB_HORIZON_MS) } },
      orderBy: { startsAt: 'asc' },
      include: { room: { select: { code: true, floorId: true } } },
    }),
  ]);

  // One entry per club: its next (or current) session.
  const clubs = new Map<string, (typeof clubSessions)[number]>();
  for (const s of clubSessions) if (!clubs.has(s.organizer)) clubs.set(s.organizer, s);

  return {
    generatedAt: now.toISOString(),
    buildings: buildings.map((b) => ({ id: b.id, code: b.code, name: b.name, nameAr: b.nameAr, floors: b.floors })),
    rooms: rooms.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      nameAr: r.nameAr,
      type: r.type,
      buildingCode: r.floor.building.code,
      floorId: r.floorId,
      level: r.floor.level,
    })),
    pois: pois.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      nameAr: p.nameAr,
      floorId: p.floorId,
      level: p.level,
      buildingCode: p.floor?.building.code ?? null,
      x: p.x,
      y: p.y,
    })),
    clubs: [...clubs.values()].map((s) => ({
      name: s.organizer,
      roomCode: s.room.code,
      floorId: s.room.floorId,
      title: s.title,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
  };
}
