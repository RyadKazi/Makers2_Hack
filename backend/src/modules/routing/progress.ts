/** Where a position is along a route. Pure: no I/O. */
import type { OrientedEdge } from './pathfinder.js';

export type Position = { x: number; y: number; level: number };

export type Progress = {
  /** Index of the closest route edge on the position's level, -1 when the route never visits that level. */
  edgeIndex: number;
  /** Distance from the position to the route, metres (Infinity on a level the route does not visit). */
  distanceM: number;
  /** Metres already covered, measured along the route up to the projection. */
  completedM: number;
  remainingM: number;
};

function projectOnSegment(p: Position, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
  return { d: Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)), t };
}

export function trackProgress(edges: readonly OrientedEdge[], p: Position, startNode?: { x: number; y: number; level: number }): Progress {
  const total = edges.reduce((s, e) => s + e.edge.lengthM, 0);
  let best: Progress = { edgeIndex: -1, distanceM: Infinity, completedM: 0, remainingM: total };

  if (edges.length === 0 && startNode && startNode.level === p.level) {
    return { edgeIndex: -1, distanceM: Math.hypot(p.x - startNode.x, p.y - startNode.y), completedM: 0, remainingM: 0 };
  }

  let before = 0;
  edges.forEach((e, i) => {
    const onLevel = e.from.level === p.level || e.to.level === p.level;
    if (onLevel) {
      const { d, t } =
        e.from.level === e.to.level
          ? projectOnSegment(p, e.from.x, e.from.y, e.to.x, e.to.y)
          : // vertical edge: the walker is at the elevator / stairs on one of its levels
            { d: Math.hypot(p.x - e.from.x, p.y - e.from.y), t: e.to.level === p.level ? 1 : 0 };
      // Prefer later edges on ties so progress does not go backwards at shared nodes.
      if (d <= best.distanceM) {
        const completed = before + t * e.edge.lengthM;
        best = { edgeIndex: i, distanceM: d, completedM: completed, remainingM: Math.max(0, total - completed) };
      }
    }
    before += e.edge.lengthM;
  });
  return best;
}
