import { describe, expect, it } from 'vitest';
import { KEY_NODES } from '../prisma/seed/campus.js';
import { NO_CONSTRAINTS } from '../src/modules/routing/constraints.js';
import type { RoutingEdge, RoutingNode } from '../src/modules/routing/graph.repository.js';
import { buildSteps, turnBetween, walkerWallSide } from '../src/modules/routing/instructions.js';
import { findPath, orient, type OrientedEdge } from '../src/modules/routing/pathfinder.js';
import { etaSeconds, WHEELCHAIR_SPEED } from '../src/modules/routing/planner.js';
import { trackProgress } from '../src/modules/routing/progress.js';
import { doorOf, seedGraph } from './helpers/graph.js';

const node = (id: string, x: number, y: number, level = 0, floorId: string | null = 'F0'): RoutingNode => ({ id, floorId, level, kind: 'CORRIDOR', label: id, landmark: null, x, y });
const edge = (id: string, a: RoutingNode, b: RoutingNode, extra: Partial<RoutingEdge> = {}): RoutingEdge => ({
  id,
  fromId: a.id,
  toId: b.id,
  bidirectional: true,
  lengthM: Math.hypot(b.x - a.x, b.y - a.y),
  hasStairs: false,
  stepCount: 0,
  isRamp: false,
  slopePercent: 0,
  widthCm: 150,
  doorClearanceCm: null,
  surface: 'TILE',
  isElevator: false,
  isOpen: true,
  closedReason: null,
  verified: true,
  wallSide: 'NONE',
  wallDistanceM: null,
  shorelineHint: null,
  ...extra,
});
const walk = (e: RoutingEdge, from: RoutingNode, to: RoutingNode): OrientedEdge => ({ edge: e, from, to, reversed: e.fromId !== from.id });

describe('geometry', () => {
  const o = node('o', 0, 0);
  const east = node('e', 10, 0);
  const ne = node('ne', 10, 10);
  const se = node('se', 10, -10);

  it('detects left and right turns (x east, y north)', () => {
    const first = walk(edge('1', o, east), o, east);
    expect(turnBetween(first, walk(edge('2', east, ne), east, ne))).toBe('LEFT');
    expect(turnBetween(first, walk(edge('3', east, se), east, se))).toBe('RIGHT');
    expect(turnBetween(first, walk(edge('4', east, node('far', 20, 1)), east, node('far', 20, 1)))).toBe('STRAIGHT');
    expect(turnBetween(first, walk(edge('5', east, o), east, o))).toBe('U_TURN');
  });

  it('flips the wall side when an edge is walked backwards', () => {
    const e = edge('w', o, east, { wallSide: 'LEFT' });
    expect(walkerWallSide(walk(e, o, east))).toBe('LEFT');
    expect(walkerWallSide(walk(e, east, o))).toBe('RIGHT');
    expect(walkerWallSide(walk(edge('b', o, east, { wallSide: 'BOTH' }), east, o))).toBe('BOTH');
  });
});

describe('buildSteps on the seed campus: gate → B-212, step-free', () => {
  const g = seedGraph();
  const path = findPath(g, KEY_NODES.gate, doorOf('B-212'), { ...NO_CONSTRAINTS, avoidStairs: true })!;
  const { nodes, edges } = orient(g, path);
  const steps = (lang: 'fr' | 'en' | 'ar', shoreline = false) =>
    buildSteps(nodes, edges, { lang, shoreline, destinationName: 'Salle B-212', originName: 'Portail principal' });

  it('starts, enters through the side entrance, takes ONE elevator ride to floor 2, and arrives', () => {
    const s = steps('en');
    expect(s[0]!.type).toBe('START');
    expect(s.at(-1)).toMatchObject({ type: 'ARRIVE', instruction: 'You have arrived: Salle B-212' });
    const enter = s.find((x) => x.type === 'ENTER')!;
    expect(enter.instruction).toContain('Entrée latérale Bloc B');
    const elevators = s.filter((x) => x.type === 'ELEVATOR');
    expect(elevators).toHaveLength(1);
    expect(elevators[0]).toMatchObject({ level: 0, toLevel: 2, instruction: 'Take the elevator to the floor 2' });
    expect(s.some((x) => x.type === 'STAIRS' || x.type === 'STEPS')).toBe(false);
    expect(s.map((x) => x.index)).toEqual(s.map((_, i) => i));
  });

  it('every edge of the path belongs to exactly one step', () => {
    expect(steps('fr').flatMap((x) => x.edgeIds)).toEqual(path.edgeIds);
  });

  it('includes turns and landmarks', () => {
    const s = steps('fr');
    expect(s.some((x) => x.turn === 'LEFT' || x.turn === 'RIGHT')).toBe(true);
    // Gate → esplanade → courtyard is one straight run: aim for its end landmark.
    expect(s[1]).toMatchObject({ type: 'WALK', turn: 'STRAIGHT', landmark: 'mât du drapeau' });
    expect(s[1]!.instruction).toBe('Avancez tout droit sur 70 m jusqu’à mât du drapeau');
  });

  it('adds shoreline sentences only when asked, with the walker-relative side', () => {
    const plain = steps('fr');
    const blind = steps('fr', true);
    expect(plain.some((x) => x.instruction.includes('Gardez'))).toBe(false);
    const withWall = blind.find((x) => x.shoreline && x.shoreline.side !== 'BOTH')!;
    expect(withWall.instruction).toMatch(/Gardez (le mur|la bordure) à votre (gauche|droite) sur \d+ m/);
    expect(blind.some((x) => /Murs des deux côtés sur \d+ m/.test(x.instruction))).toBe(true);
  });

  it('speaks Arabic and English too', () => {
    const ar = steps('ar', true);
    expect(ar.at(-1)!.instruction).toBe('لقد وصلت: Salle B-212');
    expect(ar.find((x) => x.type === 'ELEVATOR')!.instruction).toBe('استقل المصعد إلى الطابق 2');
    expect(ar.some((x) => x.instruction.includes('على الجانبين'))).toBe(true);
    expect(steps('en', true).some((x) => /Keep the (wall|edge) on your (left|right) for \d+ m/.test(x.instruction))).toBe(true);
  });

  it('estimates a longer time in a wheelchair and counts the elevator wait', () => {
    const walking = etaSeconds(edges, 'walking', 1.3);
    const wheelchair = etaSeconds(edges, 'wheelchair', 1.3);
    expect(wheelchair).toBeGreaterThan(walking);
    const distance = edges.reduce((d, e) => d + e.edge.lengthM, 0);
    expect(wheelchair).toBeGreaterThanOrEqual(Math.round(distance / WHEELCHAIR_SPEED));
  });
});

describe('the fastest route to B-212 climbs the steps and the stairs', () => {
  it('describes steps and a stair flight', () => {
    const g = seedGraph();
    const path = findPath(g, KEY_NODES.gate, doorOf('B-212'), NO_CONSTRAINTS)!;
    const { nodes, edges } = orient(g, path);
    const s = buildSteps(nodes, edges, { lang: 'fr', shoreline: false, destinationName: 'B-212', originName: null });
    expect(s.find((x) => x.type === 'STEPS')!.instruction).toContain('franchissez 3 marches');
    expect(s.find((x) => x.type === 'STAIRS')!.instruction).toBe('Montez l’escalier jusqu’au 2e étage (48 marches)');
  });
});

describe('trackProgress', () => {
  const g = seedGraph();
  const path = findPath(g, KEY_NODES.gate, KEY_NODES.courtyard, NO_CONSTRAINTS)!; // straight north: (110,5) → (110,75)
  const { edges } = orient(g, path);

  it('projects a position onto the route', () => {
    const p = trackProgress(edges, { x: 111, y: 30, level: 0 });
    expect(p.distanceM).toBeCloseTo(1);
    expect(p.completedM).toBeCloseTo(25);
    expect(p.remainingM).toBeCloseTo(45);
  });

  it('reports a level the route never visits', () => {
    expect(trackProgress(edges, { x: 110, y: 30, level: 2 })).toMatchObject({ edgeIndex: -1, distanceM: Infinity });
  });
});
