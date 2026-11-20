/**
 * Spatial reads (raw SQL + PostGIS). Geometries are returned with ST_AsGeoJSON,
 * coordinates rounded to the centimetre, in local campus metres.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export type Geometry = { type: 'Point' | 'LineString' | 'Polygon' | 'MultiPolygon' | 'MultiLineString'; coordinates: unknown[] };

/** Rows are scoped to one floor, or to the outdoors when `floorId` is null. */
const floorFilter = (column: Prisma.Sql, floorId: string | null): Prisma.Sql =>
  floorId === null ? Prisma.sql`${column} IS NULL` : Prisma.sql`${column} = ${floorId}`;

export type RoomShapeRow = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: 'CLASSROOM' | 'LAB' | 'AMPHITHEATER' | 'LIBRARY' | 'OFFICE' | 'MEETING';
  capacity: number;
  wheelchairSpaces: number;
  hearingLoop: boolean;
  geometry: Geometry | null;
};

export function roomShapes(floorId: string): Promise<RoomShapeRow[]> {
  return prisma.$queryRaw<RoomShapeRow[]>`
    SELECT id, code, name, "nameAr", type::text AS type, capacity, "wheelchairSpaces", "hearingLoop",
           ST_AsGeoJSON(COALESCE(shape, geom), 2)::json AS geometry
    FROM rooms WHERE "floorId" = ${floorId} ORDER BY code`;
}

export type PoiRow = {
  id: string;
  type: string;
  name: string;
  nameAr: string | null;
  accessible: boolean;
  notes: string | null;
  level: number;
  navNodeId: string | null;
  geometry: Geometry | null;
};

export function pois(floorId: string | null, types: readonly string[]): Promise<PoiRow[]> {
  if (types.length === 0) return Promise.resolve([]);
  return prisma.$queryRaw<PoiRow[]>`
    SELECT id, type::text AS type, name, "nameAr", accessible, notes, level, "navNodeId",
           ST_AsGeoJSON(geom, 2)::json AS geometry
    FROM pois
    WHERE ${floorFilter(Prisma.sql`"floorId"`, floorId)} AND type::text = ANY(${[...types]}::text[])
    ORDER BY type, name`;
}

export type WallRow = { id: string; kind: 'WALL' | 'GLASS' | 'RAILING' | 'CURB' | 'GRASS_EDGE'; label: string | null; geometry: Geometry | null };

export function walls(floorId: string | null): Promise<WallRow[]> {
  return prisma.$queryRaw<WallRow[]>`
    SELECT id, kind::text AS kind, label, ST_AsGeoJSON(geom, 2)::json AS geometry
    FROM walls WHERE ${floorFilter(Prisma.sql`"floorId"`, floorId)}
    ORDER BY id`;
}

export type PassageRow = {
  id: string;
  isOpen: boolean;
  closedReason: string | null;
  hasStairs: boolean;
  stepCount: number;
  isRamp: boolean;
  slopePercent: number;
  widthCm: number;
  doorClearanceCm: number | null;
  surface: string;
  verified: boolean;
  geometry: Geometry | null;
};

/**
 * Horizontal edges touching a floor (or the outdoors). Vertical links (stairs,
 * elevators between levels) are excluded: they have no length on a 2D plan.
 */
export function passages(floorId: string | null): Promise<PassageRow[]> {
  const touches =
    floorId === null
      ? Prisma.sql`(a."floorId" IS NULL OR b."floorId" IS NULL)`
      : Prisma.sql`(a."floorId" = ${floorId} OR b."floorId" = ${floorId})`;
  return prisma.$queryRaw<PassageRow[]>`
    SELECT e.id, e."isOpen", e."closedReason", e."hasStairs", e."stepCount", e."isRamp", e."slopePercent",
           e."widthCm", e."doorClearanceCm", e.surface::text AS surface, e.verified,
           ST_AsGeoJSON(e.geom, 2)::json AS geometry
    FROM nav_edges e
    JOIN nav_nodes a ON a.id = e."fromId"
    JOIN nav_nodes b ON b.id = e."toId"
    WHERE ${touches} AND a.level = b.level AND NOT e."isElevator"
    ORDER BY e.id`;
}

export type OutlineRow = { geometry: Geometry | null; minX: number | null; minY: number | null; maxX: number | null; maxY: number | null };

export async function floorOutline(floorId: string): Promise<OutlineRow> {
  const rows = await prisma.$queryRaw<OutlineRow[]>`
    SELECT ST_AsGeoJSON(g, 2)::json AS geometry,
           ST_XMin(g) AS "minX", ST_YMin(g) AS "minY", ST_XMax(g) AS "maxX", ST_YMax(g) AS "maxY"
    FROM (SELECT COALESCE(f.outline, b.footprint) AS g FROM floors f JOIN buildings b ON b.id = f."buildingId" WHERE f.id = ${floorId}) s`;
  return rows[0] ?? { geometry: null, minX: null, minY: null, maxX: null, maxY: null };
}

export async function buildingFootprints(): Promise<Map<string, Geometry | null>> {
  const rows = await prisma.$queryRaw<{ id: string; geometry: Geometry | null }[]>`
    SELECT id, ST_AsGeoJSON(footprint, 2)::json AS geometry FROM buildings`;
  return new Map(rows.map((r) => [r.id, r.geometry]));
}

export type CampusRow = {
  id: string;
  name: string;
  nameAr: string;
  timezone: string;
  geofence: Geometry | null;
  minX: number | null;
  minY: number | null;
  maxX: number | null;
  maxY: number | null;
};

export async function campus(): Promise<CampusRow | null> {
  const rows = await prisma.$queryRaw<CampusRow[]>`
    SELECT id, name, "nameAr", timezone, ST_AsGeoJSON(geofence, 2)::json AS geofence,
           ST_XMin(geofence) AS "minX", ST_YMin(geofence) AS "minY", ST_XMax(geofence) AS "maxX", ST_YMax(geofence) AS "maxY"
    FROM campuses ORDER BY name LIMIT 1`;
  return rows[0] ?? null;
}

/** Floors whose plans show this edge (plus null for the outdoors). Used by `edge:status`. */
export async function edgeFloorIds(edgeId: string): Promise<(string | null)[]> {
  const rows = await prisma.$queryRaw<{ floorId: string | null }[]>`
    SELECT DISTINCT n."floorId" FROM nav_edges e JOIN nav_nodes n ON n.id IN (e."fromId", e."toId") WHERE e.id = ${edgeId}`;
  return rows.map((r) => r.floorId);
}
