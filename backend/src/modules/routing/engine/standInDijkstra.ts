/**
 * TEMPORARY STAND-IN ENGINE — replace with the teammate's algorithm (../core/).
 *
 * Wraps the constraint-aware Dijkstra written in step 1 (../graph.ts) so the
 * rest of the routing module can be built and tested now. When the real
 * algorithm lands in ../core/, write its adapter next to this file (same
 * RoutingEngine interface) and switch `activeEngine` in ./index.ts.
 */
import { edgeCost, shortestPath, type GraphEdge } from '../graph.js';
import type { RoutingEdge } from '../graph.repository.js';
import type { EngineConstraint, RoutingEngine } from './types.js';

/** graph.ts works directly on an edge list. */
type StandInGraph = { edges: readonly RoutingEdge[] };

const SUPPORTED: ReadonlySet<EngineConstraint> = new Set<EngineConstraint>([
  'excludeClosed',
  'avoidStairs',
  'maxSlopePercent',
  'minWidthCm',
  'verifiedRampsOnly',
  'avoidEdges',
  // 'verifiedOnly' is NOT supported natively → the constraints layer pre-filters edges.
]);

export const standInDijkstra: RoutingEngine<StandInGraph> = {
  id: 'stand-in-dijkstra',
  owner: 'CampusWay API (step 1) — placeholder until the routing core is delivered',
  capabilities: { constraints: SUPPORTED, customEdgeCost: true, multiFloor: true },

  buildGraph: (_nodes, edges) => ({ edges }),

  findPath(graph, { fromNodeId, toNodeId, constraints, edgeCost: cost }) {
    const route = shortestPath(
      graph.edges,
      fromNodeId,
      toNodeId,
      {
        allowClosed: constraints.excludeClosed === false,
        stepFree: constraints.avoidStairs ?? false,
        maxSlopePercent: constraints.maxSlopePercent ?? null,
        minWidthCm: constraints.minWidthCm ?? null,
        requireVerifiedRamps: constraints.verifiedRampsOnly ?? false,
        ...(constraints.avoidEdges ? { avoidEdgeIds: constraints.avoidEdges } : {}),
      },
      cost ? (e: GraphEdge) => cost(e as RoutingEdge) : edgeCost,
    );
    return route ? { nodeIds: route.nodeIds, edgeIds: route.edgeIds } : null;
  },
};
