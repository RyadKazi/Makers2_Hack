/**
 * In-memory campus navigation graph, loaded from nav_nodes / nav_edges.
 * Loaded at startup (warmCampusGraph), cached, and reloaded when an edge changes
 * (passage closed, elevator out of service) or a map correction is approved.
 * This is OUR canonical format; routing engines get it through their adapter.
 */
import { bus } from '../../lib/events.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { reachableFrom, type GraphEdge, type RouteConstraints } from './graph.js';

export type WallSide = 'LEFT' | 'RIGHT' | 'BOTH' | 'NONE';

export type RoutingNode = {
  id: string;
  floorId: string | null;
  level: number;
  kind: string;
  label: string | null;
  landmark: string | null;
  x: number;
  y: number;
};

export type RoutingEdge = GraphEdge & {
  stepCount: number;
  surface: string;
  closedReason: string | null;
  /** Relative to the from → to direction. */
  wallSide: WallSide;
  wallDistanceM: number | null;
  shorelineHint: string | null;
};

export type FloorInfo = { id: string; level: number; name: string; buildingCode: string };

export type CampusGraph = {
  /** Increments on every reload; caches keyed on it invalidate themselves. */
  version: number;
  nodes: Map<string, RoutingNode>;
  edges: RoutingEdge[];
  edgeById: Map<string, RoutingEdge>;
  floors: Map<string, FloorInfo>;
  /** Outdoor entrance nodes (campus gates): the starting points for "reachable from outside". */
  entryNodeIds: string[];
  loadedAt: number;
};

const TTL_MS = 60_000;
let cache: Promise<CampusGraph> | null = null;
let cachedAt = 0;
let version = 0;

async function load(): Promise<CampusGraph> {
  const [nodes, edges, floors] = await Promise.all([
    prisma.navNode.findMany({ select: { id: true, floorId: true, level: true, kind: true, label: true, landmark: true, x: true, y: true } }),
    prisma.navEdge.findMany({
      select: {
        id: true,
        fromId: true,
        toId: true,
        bidirectional: true,
        lengthM: true,
        hasStairs: true,
        stepCount: true,
        isRamp: true,
        slopePercent: true,
        widthCm: true,
        doorClearanceCm: true,
        surface: true,
        isElevator: true,
        isOpen: true,
        closedReason: true,
        verified: true,
        wallSide: true,
        wallDistanceM: true,
        shorelineHint: true,
      },
    }),
    prisma.floor.findMany({ select: { id: true, level: true, name: true, building: { select: { code: true } } } }),
  ]);
  version += 1;
  return {
    version,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
    edgeById: new Map(edges.map((e) => [e.id, e])),
    floors: new Map(floors.map((f) => [f.id, { id: f.id, level: f.level, name: f.name, buildingCode: f.building.code }])),
    entryNodeIds: nodes.filter((n) => n.kind === 'ENTRANCE' && n.floorId === null).map((n) => n.id),
    loadedAt: Date.now(),
  };
}

/** Navigation graph, cached for a minute and invalidated whenever an edge changes. */
export function getCampusGraph(): Promise<CampusGraph> {
  if (!cache || Date.now() - cachedAt > TTL_MS) {
    cachedAt = Date.now();
    cache = load().catch((err: unknown) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}

export function invalidateCampusGraph(): void {
  cache = null;
}

/** Load at startup so the first route request is fast. Failure is logged, not fatal (DB may still be starting). */
export async function warmCampusGraph(): Promise<void> {
  try {
    const g = await getCampusGraph();
    logger.info({ nodes: g.nodes.size, edges: g.edges.length }, 'navigation graph loaded');
  } catch (err) {
    logger.warn({ err }, 'navigation graph not loaded yet');
  }
}

bus.on('edge.changed', invalidateCampusGraph);
bus.on('graph.changed', invalidateCampusGraph);

/** Nodes reachable from any campus entrance under the given constraints. */
export function reachableFromEntrances(graph: CampusGraph, constraints: RouteConstraints): Set<string> {
  const all = new Set<string>();
  for (const entry of graph.entryNodeIds) {
    for (const id of reachableFrom(graph.edges, entry, constraints)) all.add(id);
  }
  return all;
}
