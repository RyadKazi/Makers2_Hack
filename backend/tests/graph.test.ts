import { describe, expect, it } from 'vitest';
import { edgeAllowed, shortestPath, type GraphEdge } from '../src/modules/routing/graph.js';

const edge = (id: string, fromId: string, toId: string, lengthM: number, extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id,
  fromId,
  toId,
  bidirectional: true,
  lengthM,
  hasStairs: false,
  isRamp: false,
  slopePercent: 0,
  widthCm: 150,
  doorClearanceCm: null,
  isElevator: false,
  isOpen: true,
  verified: true,
  ...extra,
});

//   A ──stairs 10── B
//   A ──ramp 30──── B   (slope 6, unverified)
//   A ──flat 50──── B
const edges = [
  edge('stairs', 'A', 'B', 10, { hasStairs: true }),
  edge('ramp', 'A', 'B', 30, { isRamp: true, slopePercent: 6, verified: false }),
  edge('flat', 'A', 'B', 50),
];

describe('shortestPath', () => {
  it('takes the shortest edge without constraints', () => {
    expect(shortestPath(edges, 'A', 'B')?.edgeIds).toEqual(['stairs']);
  });

  it('is the shortest AMONG compliant routes', () => {
    expect(shortestPath(edges, 'A', 'B', { stepFree: true })?.edgeIds).toEqual(['ramp']);
    expect(shortestPath(edges, 'A', 'B', { stepFree: true, requireVerifiedRamps: true })?.edgeIds).toEqual(['flat']);
    expect(shortestPath(edges, 'A', 'B', { stepFree: true, maxSlopePercent: 5 })?.edgeIds).toEqual(['flat']);
  });

  it('traverses bidirectional edges backwards', () => {
    expect(shortestPath(edges, 'B', 'A')?.nodeIds).toEqual(['B', 'A']);
  });

  it('respects one-way edges', () => {
    const oneWay = [edge('e', 'A', 'B', 5, { bidirectional: false })];
    expect(shortestPath(oneWay, 'A', 'B')).not.toBeNull();
    expect(shortestPath(oneWay, 'B', 'A')).toBeNull();
  });

  it('returns null when no compliant route exists', () => {
    expect(shortestPath([edges[0]!], 'A', 'B', { stepFree: true })).toBeNull();
  });

  it('reroutes around avoided edges', () => {
    expect(shortestPath(edges, 'A', 'B', { avoidEdgeIds: new Set(['stairs', 'ramp']) })?.edgeIds).toEqual(['flat']);
  });

  it('adds an elevator penalty to cost but not to length', () => {
    const r = shortestPath([edge('lift', 'A', 'B', 4, { isElevator: true })], 'A', 'B')!;
    expect(r.lengthM).toBe(4);
    expect(r.cost).toBeGreaterThan(4);
  });
});

describe('edgeAllowed', () => {
  it('excludes closed passages unless allowed', () => {
    const closed = edge('c', 'A', 'B', 1, { isOpen: false });
    expect(edgeAllowed(closed, {})).toBe(false);
    expect(edgeAllowed(closed, { allowClosed: true })).toBe(true);
  });

  it('checks both corridor width and door clearance', () => {
    expect(edgeAllowed(edge('d', 'A', 'B', 1, { widthCm: 120, doorClearanceCm: 75 }), { minWidthCm: 80 })).toBe(false);
    expect(edgeAllowed(edge('d', 'A', 'B', 1, { widthCm: 70 }), { minWidthCm: 80 })).toBe(false);
    expect(edgeAllowed(edge('d', 'A', 'B', 1, { widthCm: 90, doorClearanceCm: 90 }), { minWidthCm: 80 })).toBe(true);
  });
});
