import { buildCampus, type CampusModel } from '../../prisma/seed/campus.js';
import type { CampusGraph, RoutingEdge } from '../../src/modules/routing/graph.repository.js';

let version = 10_000;

/** The seed campus as an in-memory CampusGraph (floor ids = seed floor keys, e.g. "B2"). No database. */
export function seedGraph(mutate?: (edges: RoutingEdge[]) => void, model: CampusModel = buildCampus()): CampusGraph {
  const edges: RoutingEdge[] = model.edges.map((e) => ({ ...e }));
  mutate?.(edges);
  const nodes = new Map(model.nodes.map((n) => [n.id, { id: n.id, floorId: n.floorKey, level: n.level, kind: n.kind, label: n.label, landmark: n.landmark, x: n.x, y: n.y }]));
  version += 1;
  return {
    version,
    nodes,
    edges,
    edgeById: new Map(edges.map((e) => [e.id, e])),
    floors: new Map(model.floors.map((f) => [f.key, { id: f.key, level: f.level, name: f.name, buildingCode: f.buildingCode }])),
    entryNodeIds: model.nodes.filter((n) => n.kind === 'ENTRANCE' && n.floorKey === null).map((n) => n.id),
    loadedAt: Date.now(),
  };
}

export const setEdge = (id: string, patch: Partial<RoutingEdge>) => (edges: RoutingEdge[]) => {
  const e = edges.find((x) => x.id === id);
  if (!e) throw new Error(`no edge ${id}`);
  Object.assign(e, patch);
};

export const doorOf = (code: string): string => buildCampus().rooms.find((r) => r.code === code)!.doorNodeId;
