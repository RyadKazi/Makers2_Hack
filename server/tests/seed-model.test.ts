import { describe, expect, it } from 'vitest';
import { buildCampus, KEY_EDGES, KEY_NODES } from '../prisma/seed/campus.js';
import { algiersDayKey, algiersTime, generateMobility } from '../prisma/seed/mobility.js';
import { buildReservations } from '../prisma/seed/people.js';
import { createRng } from '../prisma/seed/random.js';
import { reachableFrom, shortestPath, type RouteConstraints } from '../src/modules/routing/graph.js';

const model = buildCampus();
const WHEELCHAIR: RouteConstraints = { stepFree: true, requireVerifiedRamps: true, maxSlopePercent: 6, minWidthCm: 85 };
const door = (code: string): string => model.rooms.find((r) => r.code === code)!.doorNodeId;

describe('campus model', () => {
  it('has 2 buildings × 3 floors and about 40 rooms including the named ones', () => {
    expect(model.buildings.map((b) => b.name)).toEqual(['Bloc A', 'Bloc B']);
    expect(model.floors).toHaveLength(6);
    expect(model.rooms.length).toBeGreaterThanOrEqual(38);
    expect(model.rooms.length).toBeLessThanOrEqual(48);
    const names = model.rooms.map((r) => r.name);
    for (const n of ['Bibliothèque centrale', 'Amphi 1']) expect(names).toContain(n);
    for (const c of ['A-104', 'B-212']) expect(model.rooms.map((r) => r.code)).toContain(c);
  });

  it('has unique ids and edges that reference existing nodes', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
    expect(new Set(model.edges.map((e) => e.id)).size).toBe(model.edges.length);
    for (const e of model.edges) {
      expect(ids.has(e.fromId), e.fromId).toBe(true);
      expect(ids.has(e.toId), e.toId).toBe(true);
      expect(e.lengthM).toBeGreaterThan(0);
    }
  });

  it('includes stairs, ramps, elevators and exactly one closed passage', () => {
    expect(model.edges.some((e) => e.hasStairs)).toBe(true);
    expect(model.edges.some((e) => e.isRamp)).toBe(true);
    expect(model.edges.some((e) => e.isElevator)).toBe(true);
    expect(model.edges.filter((e) => !e.isOpen).map((e) => e.id)).toEqual([KEY_EDGES.bridge]);
  });

  it('every node is reachable from the main gate', () => {
    const reachable = reachableFrom(model.edges, KEY_NODES.gate);
    const missing = model.nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id);
    expect(missing).toEqual([]);
  });

  it('every room is reachable in a wheelchair except narrow doors (A-102: 75 cm, B-104: 80 cm)', () => {
    const reachable = reachableFrom(model.edges, KEY_NODES.gate, WHEELCHAIR);
    const unreachable = model.rooms.filter((r) => !reachable.has(r.doorNodeId)).map((r) => r.code);
    expect(unreachable.sort()).toEqual(['A-102', 'B-104']);
    const at80 = reachableFrom(model.edges, KEY_NODES.gate, { ...WHEELCHAIR, minWidthCm: 80 });
    expect(model.rooms.filter((r) => !at80.has(r.doorNodeId)).map((r) => r.code)).toEqual(['A-102']);
  });

  it('wheelchair route to B-212 avoids the 3-step entrance and uses the side entrance + elevator', () => {
    const route = shortestPath(model.edges, KEY_NODES.gate, door('B-212'), WHEELCHAIR)!;
    expect(route).not.toBeNull();
    expect(route.edgeIds).not.toContain(KEY_EDGES.bMainEntranceSteps);
    expect(route.nodeIds).toContain('B0-SIDE');
    expect(route.nodeIds).toContain('B2-ELEV');
    // ...and is longer than the unconstrained route, which takes the steps
    const direct = shortestPath(model.edges, KEY_NODES.gate, door('B-212'))!;
    expect(direct.edgeIds).toContain(KEY_EDGES.bMainEntranceSteps);
    expect(route.lengthM).toBeGreaterThan(direct.lengthM);
  });

  it('wheelchair route to the library avoids the steep ramp', () => {
    const route = shortestPath(model.edges, KEY_NODES.gate, door('A-BIB'), WHEELCHAIR)!;
    expect(route.edgeIds).not.toContain(KEY_EDGES.libraryRamp);
    expect(route.nodeIds).toContain('A0-ENT');
  });

  it('never routes through the closed footbridge', () => {
    const route = shortestPath(model.edges, door('A-104'), door('B-212'))!;
    expect(route.edgeIds).not.toContain(KEY_EDGES.bridge);
    expect(shortestPath(model.edges, door('A-104'), door('B-212'), { allowClosed: true })!.edgeIds).toContain(KEY_EDGES.bridge);
  });
});

describe('synthetic mobility', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  const sessions = generateMobility(model, createRng(42), now, 300);
  const events = sessions.flatMap((s) => s.events);
  const count = (edgeId: string, types: string[]): number => events.filter((e) => e.edgeId === edgeId && types.includes(e.type)).length;

  it('creates 300 sessions with points inside the campus geofence', () => {
    expect(sessions).toHaveLength(300);
    for (const s of sessions) {
      expect(s.points.length).toBeGreaterThan(2);
      expect(s.endedAt.getTime()).toBeGreaterThan(s.startedAt.getTime());
      for (const p of s.points) {
        expect(p.x).toBeGreaterThan(-5);
        expect(p.x).toBeLessThan(225);
        expect(p.y).toBeGreaterThan(-5);
        expect(p.y).toBeLessThan(155);
      }
    }
  });

  it('uses daily-rotating pseudonyms and only university days (Sun–Thu)', () => {
    for (const s of sessions) {
      expect(s.pseudoId).toMatch(/^[0-9a-f]{24}$/);
      expect([5, 6]).not.toContain(new Date(`${s.dayKey}T12:00:00Z`).getUTCDay());
    }
    const pseudos = new Set(sessions.map((s) => s.pseudoId));
    expect(pseudos.size).toBeGreaterThan(100);
  });

  it('produces clear hotspots at the Bloc B steps and the library ramp', () => {
    const bSteps = count(KEY_EDGES.bMainEntranceSteps, ['STUCK', 'BLOCKED', 'HARD_TO_NAVIGATE']);
    const ramp = count(KEY_EDGES.libraryRamp, ['TOO_STEEP', 'STUCK']);
    expect(bSteps).toBeGreaterThanOrEqual(10);
    expect(ramp).toBeGreaterThanOrEqual(10);
    expect(count(KEY_EDGES.bStairs01, ['HARD_TO_NAVIGATE']) + count(KEY_EDGES.bStairs12, ['HARD_TO_NAVIGATE'])).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const again = generateMobility(model, createRng(42), now, 300);
    expect(again.map((s) => s.points.length)).toEqual(sessions.map((s) => s.points.length));
  });
});

describe('timetable', () => {
  it('converts Algiers wall-clock time (UTC+1)', () => {
    expect(algiersTime('2026-11-19', 8, 0).toISOString()).toBe('2026-11-19T07:00:00.000Z');
    expect(algiersDayKey(new Date('2026-11-19T23:30:00Z'))).toBe('2026-11-20');
  });

  it('keeps A-104 occupied by a teacher and B-212 by a club right now', () => {
    const now = new Date();
    const active = buildReservations(now).filter((r) => r.startsAt <= now && r.endsAt > now);
    expect(active.find((r) => r.roomCode === 'A-104')?.kind).toBe('TEACHER');
    expect(active.find((r) => r.roomCode === 'B-212')?.kind).toBe('CLUB');
    expect(active.find((r) => r.roomCode === 'A-103')).toBeUndefined();
  });

  it('has no overlapping reservations in the same room', () => {
    const list = buildReservations(new Date());
    for (const a of list)
      for (const b of list)
        if (a !== b && a.roomCode === b.roomCode) expect(a.endsAt <= b.startsAt || b.endsAt <= a.startsAt).toBe(true);
  });
});
