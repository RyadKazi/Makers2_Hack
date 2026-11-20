/**
 * Contract tests for the ACTIVE routing engine (today: the stand-in; tomorrow:
 * the teammate's algorithm from routing/core). They exercise it on the seed
 * graph through the adapter. If one fails because of the algorithm itself,
 * report it to its owner rather than patching the core.
 */
import { describe, expect, it } from 'vitest';
import { KEY_EDGES, KEY_NODES } from '../prisma/seed/campus.js';
import { mergeConstraints, NO_CONSTRAINTS, prepareEngineCall, type EffectiveConstraints } from '../src/modules/routing/constraints.js';
import { edgeCostFor } from '../src/modules/routing/costs.js';
import { activeEngine } from '../src/modules/routing/engine/index.js';
import type { EngineConstraint, RoutingEngine } from '../src/modules/routing/engine/types.js';
import { shortestPath } from '../src/modules/routing/graph.js';
import { findPath, validatePath } from '../src/modules/routing/pathfinder.js';
import { doorOf, seedGraph, setEdge } from './helpers/graph.js';

const WHEELCHAIR: EffectiveConstraints = mergeConstraints({ stepFree: true, requireVerifiedRamps: true, maxSlopePercent: 6, minPassageWidthCm: 85 });
const B212 = doorOf('B-212');

describe(`active engine "${activeEngine.id}" on the seed graph`, () => {
  it('declares its capabilities', () => {
    expect(activeEngine.owner).toBeTruthy();
    expect(activeEngine.capabilities.multiFloor).toBe(true);
  });

  it('returns a connected path from the gate to B-212 (validated hop by hop)', () => {
    const g = seedGraph();
    const path = findPath(g, KEY_NODES.gate, B212, NO_CONSTRAINTS)!;
    expect(path).not.toBeNull();
    expect(validatePath(g, path, KEY_NODES.gate, B212, NO_CONSTRAINTS)).toEqual([]);
    expect(path.nodeIds.at(-1)).toBe(B212);
  });

  it('step-free avoids every stair and step', () => {
    const g = seedGraph();
    const free = findPath(g, KEY_NODES.gate, B212, { ...NO_CONSTRAINTS, avoidStairs: true })!;
    expect(free.edgeIds.some((id) => g.edgeById.get(id)!.hasStairs)).toBe(false);
    expect(free.edgeIds).not.toContain(KEY_EDGES.bMainEntranceSteps);
    expect(free.nodeIds).toEqual(expect.arrayContaining(['B0-SIDE', 'B0-ELEV', 'B2-ELEV']));
    // …while the unconstrained route takes the 3 steps and the stairs
    const any = findPath(g, KEY_NODES.gate, B212, NO_CONSTRAINTS)!;
    expect(any.edgeIds).toContain(KEY_EDGES.bMainEntranceSteps);
  });

  it('never uses a closed passage (the footbridge)', () => {
    const g = seedGraph();
    const path = findPath(g, doorOf('A-104'), B212, NO_CONSTRAINTS)!;
    expect(path.edgeIds).not.toContain(KEY_EDGES.bridge);
  });

  it('a closed elevator forces a reroute (through the reopened footbridge and the A elevator)', () => {
    const open = seedGraph(setEdge(KEY_EDGES.bridge, { isOpen: true, closedReason: null }));
    const before = findPath(open, KEY_NODES.gate, B212, WHEELCHAIR)!;
    expect(before.edgeIds).toContain('E-B0-ELEV--B1-ELEV');

    const closed = seedGraph((edges) => {
      setEdge(KEY_EDGES.bridge, { isOpen: true, closedReason: null })(edges);
      setEdge('E-B0-ELEV--B1-ELEV', { isOpen: false, closedReason: 'Ascenseur en panne' })(edges);
    });
    const after = findPath(closed, KEY_NODES.gate, B212, WHEELCHAIR)!;
    expect(after).not.toBeNull();
    expect(after.edgeIds).not.toContain('E-B0-ELEV--B1-ELEV');
    expect(after.edgeIds).toContain(KEY_EDGES.bridge);
    expect(after.nodeIds).toContain('A1-ELEV');
  });

  it('returns null (does not throw) when no route satisfies the constraints', () => {
    const g = seedGraph(setEdge('E-B0-ELEV--B1-ELEV', { isOpen: false }));
    expect(findPath(g, KEY_NODES.gate, B212, WHEELCHAIR)).toBeNull();
    expect(findPath(seedGraph(), KEY_NODES.gate, doorOf('A-102'), WHEELCHAIR)).toBeNull(); // 75 cm door
  });

  it('respects slope and ramp-verification limits', () => {
    const g = seedGraph();
    const toLibrary = doorOf('A-BIB');
    const steepOk = findPath(g, KEY_NODES.courtyard, toLibrary, NO_CONSTRAINTS)!;
    expect(steepOk.edgeIds).toContain(KEY_EDGES.libraryRamp); // shortest goes up the 12 % ramp
    const capped = findPath(g, KEY_NODES.courtyard, toLibrary, { ...NO_CONSTRAINTS, maxSlopePercent: 8 })!;
    expect(capped.edgeIds).not.toContain(KEY_EDGES.libraryRamp);
    const verified = findPath(g, KEY_NODES.courtyard, toLibrary, { ...NO_CONSTRAINTS, verifiedRampsOnly: true })!;
    expect(verified.edgeIds).not.toContain(KEY_EDGES.libraryRamp);
  });

  it('applies custom edge costs when it supports them', () => {
    if (!activeEngine.capabilities.customEdgeCost) return;
    const g = seedGraph();
    const toLibrary = doorOf('A-BIB');
    // Walking: the steep unverified ramp is still the shortest. Wheelchair costs penalise it.
    const walking = findPath(g, KEY_NODES.courtyard, toLibrary, NO_CONSTRAINTS, edgeCostFor('walking'))!;
    const huge = findPath(g, KEY_NODES.courtyard, toLibrary, NO_CONSTRAINTS, (e) => (e.isRamp && !e.verified ? 1e6 : e.lengthM))!;
    expect(walking.edgeIds).toContain(KEY_EDGES.libraryRamp);
    expect(huge.edgeIds).not.toContain(KEY_EDGES.libraryRamp);
  });
});

describe('constraints layer: pre-filtering for engines without native support', () => {
  /** A bare engine that knows nothing about constraints: everything must be pre-filtered. */
  const bareEngine: RoutingEngine<{ edges: Parameters<typeof shortestPath>[0] }> = {
    id: 'bare-test-engine',
    owner: 'tests',
    capabilities: { constraints: new Set<EngineConstraint>(), customEdgeCost: false, multiFloor: true },
    buildGraph: (_n, edges) => ({ edges }),
    findPath: (g, r) => {
      const route = shortestPath(g.edges, r.fromNodeId, r.toNodeId, { allowClosed: true });
      return route ? { nodeIds: route.nodeIds, edgeIds: route.edgeIds } : null;
    },
  };

  it('lists every active constraint as pre-filtered', () => {
    const call = prepareEngineCall(bareEngine as RoutingEngine<unknown>, seedGraph().edges, WHEELCHAIR);
    expect(call.prefiltered.sort()).toEqual(['avoidStairs', 'closedPassages', 'maxSlopePercent', 'minDoorWidthCm', 'verifiedRampsOnly'].sort());
    expect(call.edges.some((e) => e.hasStairs || !e.isOpen)).toBe(false);
  });

  it.each([
    ['none', NO_CONSTRAINTS],
    ['wheelchair', WHEELCHAIR],
    ['verifiedOnly', { ...NO_CONSTRAINTS, verifiedOnly: true }],
    ['avoid an edge', { ...NO_CONSTRAINTS, avoidEdgeIds: ['E-O-PLAZA--O-COUR-N'] }],
  ])('gives the same route as native support (%s)', (_name, c) => {
    const g = seedGraph();
    for (const [from, to] of [
      [KEY_NODES.gate, B212],
      [KEY_NODES.parking, doorOf('A-BIB')],
      [doorOf('A-203'), doorOf('B-AMPHI1')],
    ] as const) {
      const native = findPath(g, from, to, c);
      const filtered = findPath(g, from, to, c, undefined, bareEngine as RoutingEngine<unknown>);
      expect(filtered?.edgeIds ?? null).toEqual(native?.edgeIds ?? null);
    }
  });

  it('pre-filters verifiedOnly for the stand-in (not supported natively)', () => {
    const call = prepareEngineCall(activeEngine, seedGraph().edges, { ...NO_CONSTRAINTS, verifiedOnly: true });
    if (activeEngine.capabilities.constraints.has('verifiedOnly')) return;
    expect(call.prefiltered).toEqual(['verifiedOnly']);
    expect(call.edges.every((e) => e.verified)).toBe(true);
  });

  it('rejects an engine that returns a broken path', () => {
    const liar: RoutingEngine<null> = {
      id: 'liar',
      owner: 'tests',
      capabilities: { constraints: new Set<EngineConstraint>(['excludeClosed']), customEdgeCost: false, multiFloor: true },
      buildGraph: () => null,
      findPath: (_g, r) => ({ nodeIds: [r.fromNodeId, r.toNodeId], edgeIds: [KEY_EDGES.bridge] }),
    };
    expect(() => findPath(seedGraph(), KEY_NODES.gate, B212, NO_CONSTRAINTS, undefined, liar as RoutingEngine<unknown>)).toThrow(/invalid path/);
  });
});

describe('mergeConstraints', () => {
  const profile = { stepFree: true, requireVerifiedRamps: true, maxSlopePercent: 6, minPassageWidthCm: 85 };

  it('starts from the profile and lets the request override it', () => {
    expect(mergeConstraints(profile)).toMatchObject({ avoidStairs: true, verifiedRampsOnly: true, maxSlopePercent: 6, minDoorWidthCm: 85, closedPassages: true });
    expect(mergeConstraints(profile, { maxSlopePercent: 8, minDoorWidthCm: null })).toMatchObject({ maxSlopePercent: 8, minDoorWidthCm: null, avoidStairs: true });
    expect(mergeConstraints(null, { avoidStairs: true })).toMatchObject({ avoidStairs: true, maxSlopePercent: null });
  });
});
