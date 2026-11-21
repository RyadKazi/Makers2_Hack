/**
 * Pure, dependency-free graph routing used by the API (step 3) and the seed.
 * The shortest path is computed only over edges that satisfy the constraints,
 * so the result is "the shortest route AMONG routes the user can actually take".
 */

export type GraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  bidirectional: boolean;
  lengthM: number;
  hasStairs: boolean;
  isRamp: boolean;
  slopePercent: number;
  widthCm: number;
  doorClearanceCm: number | null;
  isElevator: boolean;
  isOpen: boolean;
  verified: boolean;
};

export type RouteConstraints = {
  /** No stairs or steps at all (elevators and ramps allowed). */
  stepFree?: boolean;
  /** Ramps must have been verified on site. */
  requireVerifiedRamps?: boolean;
  /** Maximum ramp/path slope in percent. */
  maxSlopePercent?: number | null;
  /** Minimum corridor width / door clearance in cm. */
  minWidthCm?: number | null;
  /** Closed passages are excluded unless explicitly allowed. */
  allowClosed?: boolean;
  /** Edges to avoid (e.g. the one the user just reported as blocked → reroute). */
  avoidEdgeIds?: ReadonlySet<string>;
};

export type Route = {
  nodeIds: string[];
  edgeIds: string[];
  lengthM: number;
  /** Cost used for ranking (length + elevator waiting penalty). */
  cost: number;
};

/** Metres-equivalent added for waiting for / riding an elevator. */
export const ELEVATOR_PENALTY_M = 15;

export function edgeAllowed(edge: GraphEdge, c: RouteConstraints): boolean {
  if (!edge.isOpen && !c.allowClosed) return false;
  if (c.avoidEdgeIds?.has(edge.id)) return false;
  if (c.stepFree && edge.hasStairs) return false;
  if (c.requireVerifiedRamps && edge.isRamp && !edge.verified) return false;
  if (c.maxSlopePercent != null && edge.slopePercent > c.maxSlopePercent) return false;
  if (c.minWidthCm != null) {
    if (edge.widthCm < c.minWidthCm) return false;
    if (edge.doorClearanceCm != null && edge.doorClearanceCm < c.minWidthCm) return false;
  }
  return true;
}

export function edgeCost(edge: GraphEdge): number {
  return edge.lengthM + (edge.isElevator ? ELEVATOR_PENALTY_M : 0);
}

type Adjacency = Map<string, { to: string; edge: GraphEdge }[]>;

export function buildAdjacency(edges: readonly GraphEdge[], constraints: RouteConstraints = {}): Adjacency {
  const adj: Adjacency = new Map();
  const push = (from: string, to: string, edge: GraphEdge): void => {
    const list = adj.get(from);
    if (list) list.push({ to, edge });
    else adj.set(from, [{ to, edge }]);
  };
  for (const edge of edges) {
    if (!edgeAllowed(edge, constraints)) continue;
    push(edge.fromId, edge.toId, edge);
    if (edge.bidirectional) push(edge.toId, edge.fromId, edge);
  }
  return adj;
}

/** Minimal binary heap keyed by numeric priority. */
class MinHeap<T> {
  private items: { key: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.key <= items[i]!.key) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): { key: number; value: T } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l]!.key < items[smallest]!.key) smallest = l;
        if (r < items.length && items[r]!.key < items[smallest]!.key) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

type DijkstraResult = {
  /** Cost (length + elevator penalty) to every settled node. */
  cost: Map<string, number>;
  /** Walked length in metres to every settled node. */
  length: Map<string, number>;
  prev: Map<string, { node: string; edge: GraphEdge }>;
};

/** Edge cost used for ranking. Defaults to length + elevator penalty (`edgeCost`). */
export type EdgeCostFn = (edge: GraphEdge) => number;

function dijkstra(edges: readonly GraphEdge[], fromId: string, constraints: RouteConstraints, stopAt?: string, costOf: EdgeCostFn = edgeCost): DijkstraResult {
  const adj = buildAdjacency(edges, constraints);
  const cost = new Map<string, number>([[fromId, 0]]);
  const length = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, { node: string; edge: GraphEdge }>();
  const heap = new MinHeap<string>();
  heap.push(0, fromId);

  while (heap.size > 0) {
    const { key: d, value: node } = heap.pop()!;
    if (d > (cost.get(node) ?? Infinity)) continue;
    if (node === stopAt) break;
    for (const { to, edge } of adj.get(node) ?? []) {
      const nd = d + Math.max(0, costOf(edge));
      if (nd < (cost.get(to) ?? Infinity)) {
        cost.set(to, nd);
        length.set(to, length.get(node)! + edge.lengthM);
        prev.set(to, { node, edge });
        heap.push(nd, to);
      }
    }
  }
  return { cost, length, prev };
}

/**
 * Walked distance (metres) from `fromId` to every node reachable under the
 * constraints, along the cheapest route. Used for "nearest elevator / toilet".
 */
export function distancesFrom(
  edges: readonly GraphEdge[],
  fromId: string,
  constraints: RouteConstraints = {},
): Map<string, number> {
  return dijkstra(edges, fromId, constraints).length;
}

/** Dijkstra over the constraint-filtered graph. Returns null when no compliant route exists. */
export function shortestPath(
  edges: readonly GraphEdge[],
  fromId: string,
  toId: string,
  constraints: RouteConstraints = {},
  costOf: EdgeCostFn = edgeCost,
): Route | null {
  if (fromId === toId) return { nodeIds: [fromId], edgeIds: [], lengthM: 0, cost: 0 };

  const { cost: dist, prev } = dijkstra(edges, fromId, constraints, toId, costOf);
  if (!dist.has(toId)) return null;

  const nodeIds = [toId];
  const edgeIds: string[] = [];
  let lengthM = 0;
  let cursor = toId;
  while (cursor !== fromId) {
    const step = prev.get(cursor)!;
    nodeIds.push(step.node);
    edgeIds.push(step.edge.id);
    lengthM += step.edge.lengthM;
    cursor = step.node;
  }
  nodeIds.reverse();
  edgeIds.reverse();
  return { nodeIds, edgeIds, lengthM, cost: dist.get(toId)! };
}

/** Node ids reachable from `startId` under the given constraints (for connectivity checks). */
export function reachableFrom(
  edges: readonly GraphEdge[],
  startId: string,
  constraints: RouteConstraints = {},
): Set<string> {
  const adj = buildAdjacency(edges, constraints);
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const { to } of adj.get(node) ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  return seen;
}
