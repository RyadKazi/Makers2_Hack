/**
 * Hotspots: DBSCAN clusters of difficulty events (PostGIS ST_ClusterDBSCAN,
 * eps 4 m, ≥ 5 events), kept only with ≥ K_MIN distinct daily pseudonyms.
 * Each hotspot gets its passage (nearest edge) and its shoreline: the nearest
 * wall / curb / railing segment, with its side relative to the edge direction.
 */
import type { DifficultyType, Prisma, WallKind, WallSide } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type { CampusGraph } from '../routing/graph.repository.js';
import { periodWindow } from './heatmap.js';
import { nearestEdge } from './ingest.service.js';
import { K_MIN } from './privacy.js';

export const DBSCAN_EPS_M = 4;
export const DBSCAN_MIN_EVENTS = 5;
const MAX_WALL_DISTANCE_M = 10;

type EventRow = {
  id: string;
  type: DifficultyType;
  mobility: string;
  level: number;
  floorId: string | null;
  edgeId: string | null;
  x: number;
  y: number;
  pseudoId: string;
  cid: number | null;
};

export type ShorelineFit = { wallId: string; wallKind: WallKind; side: Exclude<WallSide, 'BOTH' | 'NONE'>; distanceM: number };

const mode = <T>(values: readonly T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Side of point P relative to the directed segment A → B (x east, y north), and its distance to the segment. */
export function sideOfSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): { side: 'LEFT' | 'RIGHT'; distanceM: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cross = dx * (py - ay) - dy * (px - ax);
  return { side: cross >= 0 ? 'LEFT' : 'RIGHT', distanceM: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) };
}

/** Nearest wall segment to a point, and where it lies relative to an edge (for shoreline guidance). */
export async function shorelineFor(graph: CampusGraph, edgeId: string | null, x: number, y: number, level: number, floorId: string | null): Promise<ShorelineFit | null> {
  const rows = await prisma.$queryRaw<{ id: string; kind: WallKind; d: number; cx: number; cy: number }[]>`
    SELECT w.id, w.kind, ST_Distance(w.geom, ST_MakePoint(${x}, ${y})) AS d,
           ST_X(ST_ClosestPoint(w.geom, ST_MakePoint(${x}, ${y}))) AS cx, ST_Y(ST_ClosestPoint(w.geom, ST_MakePoint(${x}, ${y}))) AS cy
    FROM walls w
    WHERE w.level = ${level} AND w."floorId" IS NOT DISTINCT FROM ${floorId}
    ORDER BY w.geom <-> ST_MakePoint(${x}, ${y}) LIMIT 1`;
  const wall = rows[0];
  if (!wall || wall.d > MAX_WALL_DISTANCE_M) return null;
  const edge = edgeId ? graph.edgeById.get(edgeId) : undefined;
  const a = edge && graph.nodes.get(edge.fromId);
  const b = edge && graph.nodes.get(edge.toId);
  if (!a || !b || (a.x === b.x && a.y === b.y)) {
    return { wallId: wall.id, wallKind: wall.kind, side: 'LEFT', distanceM: round(wall.d) };
  }
  const fit = sideOfSegment(a.x, a.y, b.x, b.y, wall.cx, wall.cy);
  return { wallId: wall.id, wallKind: wall.kind, side: fit.side, distanceM: round(fit.distanceM) };
}

export type HotspotRow = Prisma.HotspotCreateManyInput & { id: string; dominantType: DifficultyType };

/** Rebuilds the hotspot table from the last 30 days of difficulty events. */
export async function recomputeHotspots(graph: CampusGraph, now: Date): Promise<HotspotRow[]> {
  const { start } = periodWindow('30D', now);
  const events = await prisma.$queryRaw<EventRow[]>`
    WITH ev AS (
      SELECT e.id, e.type, e.mobility::text AS mobility, e.level, e."floorId", e."edgeId", e.x, e.y, e.geom, s."pseudoId"
      FROM difficulty_events e JOIN tracking_sessions s ON s.id = e."sessionId"
      WHERE e."recordedAt" >= ${start}
    )
    SELECT id, type, mobility, level, "floorId", "edgeId", x, y, "pseudoId",
           ST_ClusterDBSCAN(geom, eps := ${DBSCAN_EPS_M}::float8, minpoints := ${DBSCAN_MIN_EVENTS}::int) OVER (PARTITION BY level) AS cid
    FROM ev`;

  const clusters = new Map<string, EventRow[]>();
  for (const e of events) {
    if (e.cid === null) continue;
    const key = `${e.level}:${e.cid}`;
    const list = clusters.get(key);
    if (list) list.push(e);
    else clusters.set(key, [e]);
  }

  const rows: HotspotRow[] = [];
  let n = 0;
  for (const members of clusters.values()) {
    const contributors = new Set(members.map((m) => m.pseudoId)).size;
    if (contributors < K_MIN) continue;

    const x = members.reduce((s, m) => s + m.x, 0) / members.length;
    const y = members.reduce((s, m) => s + m.y, 0) / members.length;
    const level = members[0]!.level;
    const floorId = mode(members.map((m) => m.floorId).filter((f): f is string => f !== null)) ?? null;
    const byType: Record<string, number> = {};
    for (const m of members) byType[m.type] = (byType[m.type] ?? 0) + 1;

    // Categories by distinct contributors; small ones are merged so no category under K is visible.
    const perCategory = new Map<string, Set<string>>();
    for (const m of members) {
      const set = perCategory.get(m.mobility) ?? new Set<string>();
      set.add(m.pseudoId);
      perCategory.set(m.mobility, set);
    }
    const byCategory: Record<string, number> = {};
    const other = new Set<string>();
    for (const [category, ids] of perCategory) {
      if (ids.size >= K_MIN) byCategory[category] = ids.size;
      else ids.forEach((id) => other.add(id));
    }
    if (other.size >= K_MIN) byCategory.OTHER = other.size;

    const edgeId = mode(members.map((m) => m.edgeId).filter((e): e is string => e !== null)) ?? (await nearestEdge(x, y, level, 8));
    const wall = await shorelineFor(graph, edgeId, x, y, level, floorId);
    n += 1;
    rows.push({
      id: `hs-${now.getTime()}-${n}`,
      level,
      floorId,
      x: round(x),
      y: round(y),
      radiusM: round(Math.max(...members.map((m) => Math.hypot(m.x - x, m.y - y)))),
      eventCount: members.length,
      contributorCount: contributors,
      byType,
      byCategory,
      dominantType: mode(members.map((m) => m.type))!,
      edgeId,
      wallId: wall?.wallId ?? null,
      wallKind: wall?.wallKind ?? null,
      wallSide: wall?.side ?? null,
      wallDistanceM: wall?.distanceM ?? null,
      computedAt: now,
    });
  }

  await prisma.$transaction([prisma.hotspot.deleteMany({}), prisma.hotspot.createMany({ data: rows })]);
  return rows;
}

const round = (n: number): number => Math.round(n * 10) / 10;
