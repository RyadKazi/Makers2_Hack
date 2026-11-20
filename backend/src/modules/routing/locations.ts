import { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { CampusGraph } from './graph.repository.js';

export type LocationInput =
  | { type: 'room'; id: string }
  | { type: 'poi'; id: string }
  | { type: 'node'; id: string }
  | { type: 'point'; x: number; y: number; level: number; floorId?: string | undefined };

export type ResolvedLocation = {
  type: LocationInput['type'];
  nodeId: string;
  name: string;
  level: number;
  floorId: string | null;
  x: number;
  y: number;
  /** For points: how far the position was from the graph node it was snapped to. */
  snappedDistanceM: number | null;
};

/** A point further than this from any node on its level is off the map. */
export const MAX_SNAP_M = 40;

/** Nearest navigation node on a level (PostGIS KNN on the GIST index). */
export async function snapToGraph(x: number, y: number, level: number, floorId?: string): Promise<{ nodeId: string; distanceM: number } | null> {
  const floorFilter = floorId ? Prisma.sql`AND ("floorId" = ${floorId} OR "floorId" IS NULL)` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string; d: number }[]>`
    SELECT id, ST_Distance(geom, ST_MakePoint(${x}, ${y})) AS d
    FROM nav_nodes
    WHERE level = ${level} ${floorFilter}
    ORDER BY geom <-> ST_MakePoint(${x}, ${y})
    LIMIT 1`;
  const row = rows[0];
  return row ? { nodeId: row.id, distanceM: Number(row.d) } : null;
}

export async function resolveLocation(graph: CampusGraph, input: LocationInput, label: 'from' | 'to'): Promise<ResolvedLocation> {
  const node = (id: string) => {
    const n = graph.nodes.get(id);
    if (!n) throw new HttpError(404, 'LOCATION_NOT_FOUND', `${label}: navigation node ${id} not found`);
    return n;
  };

  switch (input.type) {
    case 'room': {
      const room = await prisma.room.findFirst({ where: { OR: [{ id: input.id }, { code: input.id }] }, select: { name: true, code: true, doorNodeId: true } });
      if (!room) throw new HttpError(404, 'LOCATION_NOT_FOUND', `${label}: room ${input.id} not found`);
      if (!room.doorNodeId) throw new HttpError(422, 'LOCATION_NOT_ROUTABLE', `${label}: room ${room.code} has no door on the navigation graph`);
      const n = node(room.doorNodeId);
      return { type: 'room', nodeId: n.id, name: `${room.name} (${room.code})`, level: n.level, floorId: n.floorId, x: n.x, y: n.y, snappedDistanceM: null };
    }
    case 'poi': {
      const poi = await prisma.poi.findUnique({ where: { id: input.id }, select: { name: true, navNodeId: true } });
      if (!poi) throw new HttpError(404, 'LOCATION_NOT_FOUND', `${label}: point of interest ${input.id} not found`);
      if (!poi.navNodeId) throw new HttpError(422, 'LOCATION_NOT_ROUTABLE', `${label}: ${poi.name} is not on the navigation graph`);
      const n = node(poi.navNodeId);
      return { type: 'poi', nodeId: n.id, name: poi.name, level: n.level, floorId: n.floorId, x: n.x, y: n.y, snappedDistanceM: null };
    }
    case 'node': {
      const n = node(input.id);
      return { type: 'node', nodeId: n.id, name: n.label ?? n.landmark ?? n.id, level: n.level, floorId: n.floorId, x: n.x, y: n.y, snappedDistanceM: null };
    }
    case 'point': {
      const snap = await snapToGraph(input.x, input.y, input.level, input.floorId);
      if (!snap || snap.distanceM > MAX_SNAP_M) {
        throw new HttpError(422, 'LOCATION_OFF_GRAPH', `${label}: no walkable path within ${MAX_SNAP_M} m of this position on level ${input.level}`);
      }
      const n = node(snap.nodeId);
      return {
        type: 'point',
        nodeId: n.id,
        name: n.label ?? n.landmark ?? `(${Math.round(input.x)}, ${Math.round(input.y)})`,
        level: n.level,
        floorId: n.floorId,
        x: input.x,
        y: input.y,
        snappedDistanceM: Math.round(snap.distanceM * 10) / 10,
      };
    }
  }
}
