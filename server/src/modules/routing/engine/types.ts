/**
 * The contract between accesU and a routing algorithm.
 *
 * The algorithm itself is owned by the routing teammate and lives in
 * ../core/ — it is never modified by the API code. Each algorithm is plugged
 * in through ONE adapter file implementing `RoutingEngine`:
 *   - buildGraph(): converts our in-memory graph (nav_nodes / nav_edges) into
 *     the exact graph format the algorithm expects;
 *   - findPath(): calls the algorithm and converts its result back to node/edge ids;
 *   - capabilities: which constraints it applies natively and whether it accepts
 *     custom edge costs. Anything it does not support is handled by the
 *     constraints layer BEFORE calling it (edges are filtered out).
 */
import type { RoutingEdge, RoutingNode } from '../graph.repository.js';

/** Constraints an engine may apply natively. */
export type EngineConstraint =
  | 'excludeClosed' // skip edges with isOpen = false
  | 'avoidStairs' // skip stairs and steps
  | 'maxSlopePercent'
  | 'minWidthCm' // corridor width and door clearance
  | 'verifiedRampsOnly' // skip ramps not verified on site
  | 'verifiedOnly' // skip any edge not verified on site
  | 'avoidEdges'; // skip specific edge ids

export type EngineConstraints = {
  excludeClosed?: boolean;
  avoidStairs?: boolean;
  maxSlopePercent?: number;
  minWidthCm?: number;
  verifiedRampsOnly?: boolean;
  verifiedOnly?: boolean;
  avoidEdges?: ReadonlySet<string>;
};

export type EngineCapabilities = {
  constraints: ReadonlySet<EngineConstraint>;
  /** Accepts a per-edge cost function (penalties). */
  customEdgeCost: boolean;
  /** Follows vertical edges (stairs / elevators between levels). */
  multiFloor: boolean;
};

export type EngineRequest = {
  fromNodeId: string;
  toNodeId: string;
  /** Only the constraints listed in `capabilities.constraints` are passed. */
  constraints: EngineConstraints;
  /** Only passed when `capabilities.customEdgeCost` is true. */
  edgeCost?: (edge: RoutingEdge) => number;
};

/** A path as consecutive node ids and the edge ids between them (edgeIds.length = nodeIds.length - 1). */
export type EnginePath = { nodeIds: string[]; edgeIds: string[] };

export interface RoutingEngine<G = unknown> {
  /** Short id, shown in route responses and logs. */
  readonly id: string;
  /** Who owns / maintains the algorithm. */
  readonly owner: string;
  readonly capabilities: EngineCapabilities;
  /** Converts our graph into the algorithm's format. Called once per graph version and edge filter. */
  buildGraph(nodes: ReadonlyMap<string, RoutingNode>, edges: readonly RoutingEdge[]): G;
  /** null when the algorithm finds no path. Must not throw for "no path". */
  findPath(graph: G, request: EngineRequest): EnginePath | null;
}
