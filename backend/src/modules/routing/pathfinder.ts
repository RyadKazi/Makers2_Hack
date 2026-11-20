/**
 * Calls the active routing engine through the adapter + constraints layer, and
 * checks what comes back (the engine is external code: never trust, verify).
 */
import { HttpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { edgeAllowed, prepareEngineCall, type EffectiveConstraints } from './constraints.js';
import { activeEngine, type EnginePath, type RoutingEngine } from './engine/index.js';
import type { CampusGraph, RoutingEdge, RoutingNode } from './graph.repository.js';

/** Built engine graphs, per graph version and edge filter. */
const built = new Map<string, unknown>();
let builtVersion = -1;

function engineGraph(engine: RoutingEngine<unknown>, graph: CampusGraph, edges: RoutingEdge[], filterKey: string): unknown {
  if (builtVersion !== graph.version) {
    built.clear();
    builtVersion = graph.version;
  }
  const key = `${engine.id}|${filterKey}`;
  if (!built.has(key)) {
    if (built.size > 64) built.clear();
    built.set(key, engine.buildGraph(graph.nodes, edges));
  }
  return built.get(key);
}

/** Problems with a path returned by an engine (empty = valid). */
export function validatePath(graph: CampusGraph, path: EnginePath, from: string, to: string, c: EffectiveConstraints): string[] {
  const problems: string[] = [];
  if (path.nodeIds[0] !== from) problems.push(`starts at ${path.nodeIds[0]} instead of ${from}`);
  if (path.nodeIds.at(-1) !== to) problems.push(`ends at ${path.nodeIds.at(-1)} instead of ${to}`);
  if (path.edgeIds.length !== path.nodeIds.length - 1) problems.push('edgeIds.length must equal nodeIds.length - 1');
  path.edgeIds.forEach((id, i) => {
    const e = graph.edgeById.get(id);
    const a = path.nodeIds[i];
    const b = path.nodeIds[i + 1];
    if (!e) return problems.push(`unknown edge ${id}`);
    const forward = e.fromId === a && e.toId === b;
    const backward = e.bidirectional && e.fromId === b && e.toId === a;
    if (!forward && !backward) problems.push(`edge ${id} does not connect ${a} → ${b}`);
    if (!edgeAllowed(e, c)) problems.push(`edge ${id} breaks the requested constraints`);
    return undefined;
  });
  return problems;
}

export type FoundPath = EnginePath & { engine: string; prefiltered: string[] };

export function findPath(
  graph: CampusGraph,
  fromNodeId: string,
  toNodeId: string,
  c: EffectiveConstraints,
  edgeCost?: (edge: RoutingEdge) => number,
  engine: RoutingEngine<unknown> = activeEngine,
): FoundPath | null {
  if (fromNodeId === toNodeId) return { nodeIds: [fromNodeId], edgeIds: [], engine: engine.id, prefiltered: [] };

  const call = prepareEngineCall(engine, graph.edges, c);
  const g = engineGraph(engine, graph, call.edges, call.filterKey);
  const path = engine.findPath(g, {
    fromNodeId,
    toNodeId,
    constraints: call.constraints,
    ...(edgeCost && engine.capabilities.customEdgeCost ? { edgeCost } : {}),
  });
  if (!path) return null;

  const problems = validatePath(graph, path, fromNodeId, toNodeId, c);
  if (problems.length) {
    logger.error({ engine: engine.id, fromNodeId, toNodeId, problems }, 'routing engine returned an invalid path');
    throw new HttpError(500, 'ROUTING_ENGINE_ERROR', 'The routing engine returned an invalid path', { engine: engine.id, problems });
  }
  return { ...path, engine: engine.id, prefiltered: call.prefiltered };
}

/** Nodes and oriented edges of a path, for metrics and instructions. */
export type OrientedEdge = { edge: RoutingEdge; from: RoutingNode; to: RoutingNode; reversed: boolean };

export function orient(graph: CampusGraph, path: EnginePath): { nodes: RoutingNode[]; edges: OrientedEdge[] } {
  const nodes = path.nodeIds.map((id) => graph.nodes.get(id)!);
  const edges = path.edgeIds.map((id, i) => {
    const edge = graph.edgeById.get(id)!;
    const from = nodes[i]!;
    return { edge, from, to: nodes[i + 1]!, reversed: edge.fromId !== from.id };
  });
  return { nodes, edges };
}
