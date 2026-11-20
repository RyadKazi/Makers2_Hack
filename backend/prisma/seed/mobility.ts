/**
 * Synthetic crowdsourced mobility data: ~120 pseudonymous students, 300
 * sessions over the last 14 university days (Sunday–Thursday).
 *
 * Hotspots emerge from simulated behaviour, not from hard-coded counts:
 *  - wheelchair users heading to Bloc B often try the 3-step main entrance,
 *    get stuck, and reroute to the step-free side entrance;
 *  - wheelchair / reduced-mobility users try the ≈12 % library ramp, find it
 *    too steep, and go around through the Bloc A entrance;
 *  - blind / low-vision students struggle on Bloc B stairs (one handrail);
 *  - people try the closed level-1 footbridge and get rerouted;
 *  - A-102's 75 cm door blocks wheelchairs.
 */
import { createHash } from 'node:crypto';
import { edgeAllowed, shortestPath, type RouteConstraints } from '../../src/modules/routing/graph.js';
import { KEY_EDGES, KEY_NODES, type CampusModel, type FloorKey, type SeedNode } from './campus.js';
import type { Rng } from './random.js';
import { algiersDayKey, algiersTime } from '../../src/lib/time.js';

export { algiersDayKey, algiersTime };

export type MobilityProfile = 'NONE' | 'WHEELCHAIR' | 'REDUCED_MOBILITY' | 'BLIND_LOW_VISION' | 'DEAF_HARD_OF_HEARING' | 'SPEECH';
export type DifficultyType = 'BLOCKED' | 'TOO_STEEP' | 'HARD_TO_NAVIGATE' | 'STUCK' | 'REROUTED';
export type SessionEndReason = 'USER' | 'GEOFENCE_EXIT' | 'TIME_LIMIT' | 'DAILY_RESET';

export type GenPoint = { recordedAt: Date; level: number; floorKey: FloorKey | null; x: number; y: number; accuracyM: number };
export type GenEvent = {
  type: DifficultyType;
  mobility: MobilityProfile;
  level: number;
  floorKey: FloorKey | null;
  edgeId: string | null;
  note: string | null;
  recordedAt: Date;
  x: number;
  y: number;
};
export type GenSession = {
  id: string;
  pseudoId: string;
  dayKey: string;
  mobility: MobilityProfile;
  startedAt: Date;
  endedAt: Date;
  endReason: SessionEndReason;
  points: GenPoint[];
  events: GenEvent[];
};

const PROFILE_WEIGHTS: (readonly [MobilityProfile, number])[] = [
  ['WHEELCHAIR', 22],
  ['REDUCED_MOBILITY', 10],
  ['BLIND_LOW_VISION', 18],
  ['DEAF_HARD_OF_HEARING', 10],
  ['SPEECH', 5],
  ['NONE', 35],
];

const SPEED_MS: Record<MobilityProfile, number> = {
  WHEELCHAIR: 0.9,
  REDUCED_MOBILITY: 0.7,
  BLIND_LOW_VISION: 0.75,
  DEAF_HARD_OF_HEARING: 1.25,
  SPEECH: 1.25,
  NONE: 1.3,
};

const CONSTRAINTS: Record<MobilityProfile, RouteConstraints> = {
  WHEELCHAIR: { stepFree: true, maxSlopePercent: 8, minWidthCm: 80 },
  REDUCED_MOBILITY: { maxSlopePercent: 10 },
  BLIND_LOW_VISION: {},
  DEAF_HARD_OF_HEARING: {},
  SPEECH: {},
  NONE: {},
};

const SAMPLE_INTERVAL_S = 2;

/** Daily-rotating pseudonym. Production derives it with an HMAC server secret (step 7). */
export function pseudonym(subject: string, dayKey: string): string {
  return createHash('sha256').update(`campusway-synthetic|${subject}|${dayKey}`).digest('hex').slice(0, 24);
}

type Builder = {
  points: GenPoint[];
  events: GenEvent[];
  t: number; // ms epoch
  pos: { x: number; y: number; level: number; floorKey: FloorKey | null };
};

export function generateMobility(model: CampusModel, rng: Rng, now: Date, sessionCount = 300, studentCount = 120): GenSession[] {
  const nodeById = new Map<string, SeedNode>(model.nodes.map((n) => [n.id, n]));
  const edges = model.edges;
  const edgeBetween = (a: string, b: string) =>
    edges.find((e) => (e.fromId === a && e.toId === b) || (e.bidirectional && e.fromId === b && e.toId === a));

  const students = Array.from({ length: studentCount }, (_, i) => ({ subject: `student-${i}`, mobility: rng.weighted(PROFILE_WEIGHTS) }));

  // Last 14 university days (Algerian week: Sunday → Thursday)
  const days: string[] = [];
  for (let back = 1; days.length < 14 && back < 40; back++) {
    const key = algiersDayKey(new Date(now.getTime() - back * 86_400_000));
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay(); // 5 = Fri, 6 = Sat
    if (weekday !== 5 && weekday !== 6) days.push(key);
  }

  const roomDoors = model.rooms.map((r) => r.doorNodeId);
  const doorOf = (code: string): string => model.rooms.find((r) => r.code === code)!.doorNodeId;
  const destinations: (readonly [string, number])[] = [
    ...roomDoors.map((id) => [id, 1] as const),
    [doorOf('B-AMPHI1'), 9],
    [doorOf('A-BIB'), 8],
    [doorOf('B-203'), 3],
    [doorOf('A-203'), 3],
    [doorOf('A-104'), 3],
    [doorOf('B-212'), 3],
    [doorOf('A-102'), 2],
    ['A0-WCPMR', 2],
    ['B0-WCPMR', 2],
    [KEY_NODES.cafeteria, 3],
  ];
  const isOutdoor = (id: string): boolean => nodeById.get(id)!.floorKey === null;
  const buildingOf = (id: string): string | null => nodeById.get(id)!.floorKey?.[0] ?? null;

  const sessions: GenSession[] = [];

  for (let i = 0; i < sessionCount; i++) {
    const student = rng.pick(students);
    const mobility = student.mobility;
    const dayKey = rng.pick(days);
    const start = algiersTime(dayKey, rng.int(7, 15), rng.int(0, 59)).getTime() + rng.int(0, 59) * 1000;
    const constraints = CONSTRAINTS[mobility];
    const speed = SPEED_MS[mobility] * rng.range(0.85, 1.15);
    const motorImpaired = mobility === 'WHEELCHAIR' || mobility === 'REDUCED_MOBILITY';

    const origin = rng.weighted<string>([
      [KEY_NODES.gate, 45],
      [KEY_NODES.parking, motorImpaired ? 35 : 8],
      [KEY_NODES.cafeteria, 15],
      [rng.pick(roomDoors), 25],
    ]);
    let destination = rng.weighted(destinations);
    if (destination === origin) destination = doorOf('B-AMPHI1') === origin ? doorOf('A-BIB') : doorOf('B-AMPHI1');

    const startNode = nodeById.get(origin)!;
    const b: Builder = {
      points: [],
      events: [],
      t: start,
      pos: { x: startNode.x, y: startNode.y, level: startNode.level, floorKey: startNode.floorKey },
    };

    const record = (): void => {
      b.points.push({
        recordedAt: new Date(b.t),
        level: b.pos.level,
        floorKey: b.pos.floorKey,
        x: round(b.pos.x + rng.gaussian(0.6)),
        y: round(b.pos.y + rng.gaussian(0.6)),
        accuracyM: round(rng.range(2, 6)),
      });
    };

    const moveTo = (x: number, y: number, level: number, floorKey: FloorKey | null): void => {
      const d = Math.hypot(x - b.pos.x, y - b.pos.y);
      const steps = Math.max(1, Math.round(d / (speed * SAMPLE_INTERVAL_S)));
      const { x: x0, y: y0 } = b.pos;
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        b.t += (d / steps / speed) * 1000;
        b.pos = { x: x0 + (x - x0) * f, y: y0 + (y - y0) * f, level: f < 0.5 ? b.pos.level : level, floorKey: f < 0.5 ? b.pos.floorKey : floorKey };
        record();
      }
      b.pos = { x, y, level, floorKey };
    };

    const followNodes = (nodeIds: string[]): void => {
      for (let k = 1; k < nodeIds.length; k++) {
        const prev = nodeById.get(nodeIds[k - 1]!)!;
        const node = nodeById.get(nodeIds[k]!)!;
        if (prev.level !== node.level && prev.x === node.x && prev.y === node.y) {
          // Elevator ride or stair climb: time passes, position stays
          const edge = edgeBetween(prev.id, node.id);
          b.t += (edge?.isElevator ? rng.range(25, 70) : rng.range(15, 35) / (speed / 1.3)) * 1000;
          b.pos = { x: node.x, y: node.y, level: node.level, floorKey: node.floorKey };
          record();
        } else {
          moveTo(node.x, node.y, node.level, node.floorKey);
        }
        if (mobility === 'BLIND_LOW_VISION' && node.id.startsWith('B') && node.id.endsWith('-STAIRS') && prev.id.endsWith('-STAIRS') && rng.chance(0.55)) {
          dwell(rng.range(15, 45));
          addEvent('HARD_TO_NAVIGATE', prev.id < node.id ? `E-${prev.id}--${node.id}` : `E-${node.id}--${prev.id}`, 'Une seule main courante');
        }
      }
    };

    const dwell = (seconds: number): void => {
      const n = Math.max(1, Math.round(seconds / SAMPLE_INTERVAL_S));
      for (let s = 0; s < n; s++) {
        b.t += SAMPLE_INTERVAL_S * 1000;
        record();
      }
    };

    const addEvent = (type: DifficultyType, edgeId: string | null, note: string | null = null): void => {
      b.events.push({
        type,
        mobility,
        level: b.pos.level,
        floorKey: b.pos.floorKey,
        edgeId,
        note,
        recordedAt: new Date(b.t),
        x: round(b.pos.x + rng.gaussian(0.8)),
        y: round(b.pos.y + rng.gaussian(0.8)),
      });
    };

    /** Route under constraints; on failure, relax width (narrow door) and report it. */
    const go = (from: string, to: string, c: RouteConstraints = constraints): void => {
      const route = shortestPath(edges, from, to, c) ?? shortestPath(edges, from, to, { ...c, minWidthCm: null });
      if (!route) return;
      const blockedAt = route.edgeIds.findIndex((id) => !edgeAllowed(edges.find((e) => e.id === id)!, c));
      if (blockedAt >= 0) {
        const narrow = edges.find((e) => e.id === route.edgeIds[blockedAt])!;
        followNodes(route.nodeIds.slice(0, blockedAt + 1));
        dwell(rng.range(20, 60));
        addEvent('BLOCKED', narrow.id, `Porte trop étroite (${narrow.doorClearanceCm ?? narrow.widthCm} cm)`);
        return;
      }
      followNodes(route.nodeIds);
    };

    // ─── Scenario selection ───
    const destBuilding = buildingOf(destination);
    const destLevel = nodeById.get(destination)!.level;
    const originBuilding = buildingOf(origin);
    const libraryBound = destination === doorOf('A-BIB') || (destBuilding === 'A' && destLevel === 0);

    if (motorImpaired && isOutdoor(origin) && destBuilding === 'B' && rng.chance(0.7)) {
      // Try the Bloc B main entrance (3 steps)
      go(origin, KEY_NODES.bEntranceOutside);
      if (mobility === 'WHEELCHAIR') {
        dwell(rng.range(40, 140));
        addEvent(rng.chance(0.55) ? 'STUCK' : 'BLOCKED', KEY_EDGES.bMainEntranceSteps, 'Trois marches, pas de rampe');
        addEvent('REROUTED', KEY_EDGES.bMainEntranceSteps, 'Vers l’entrée latérale');
        go(KEY_NODES.bEntranceOutside, destination);
      } else {
        dwell(rng.range(10, 40));
        addEvent('HARD_TO_NAVIGATE', KEY_EDGES.bMainEntranceSteps, 'Marches sans main courante centrale');
        go(KEY_NODES.bEntranceOutside, destination, {});
      }
    } else if (motorImpaired && isOutdoor(origin) && libraryBound && rng.chance(0.75)) {
      // Try the steep library ramp
      go(origin, KEY_NODES.libraryRampBottom);
      const bottom = nodeById.get(KEY_NODES.libraryRampBottom)!;
      const top = nodeById.get(KEY_NODES.libraryLanding)!;
      const f = rng.range(0.3, 0.7);
      moveTo(bottom.x + (top.x - bottom.x) * f, bottom.y + (top.y - bottom.y) * f, 0, null);
      dwell(rng.range(20, 90));
      addEvent('TOO_STEEP', KEY_EDGES.libraryRamp, 'Pente estimée > 10 %');
      if (mobility === 'WHEELCHAIR') {
        if (rng.chance(0.45)) addEvent('STUCK', KEY_EDGES.libraryRamp, 'Impossible de monter seul');
        moveTo(bottom.x, bottom.y, 0, null);
        addEvent('REROUTED', KEY_EDGES.libraryRamp, 'Par l’entrée du Bloc A');
        go(KEY_NODES.libraryRampBottom, destination);
      } else {
        moveTo(top.x, top.y, 0, null);
        go(KEY_NODES.libraryLanding, destination, {});
      }
    } else if (originBuilding === 'A' && destBuilding === 'B' && nodeById.get(origin)!.level > 0 && destLevel > 0 && rng.chance(0.8)) {
      // Try the closed footbridge
      go(origin, KEY_NODES.bridgeA);
      dwell(rng.range(10, 40));
      addEvent('BLOCKED', KEY_EDGES.bridge, 'Passerelle fermée');
      addEvent('REROUTED', KEY_EDGES.bridge, null);
      go(KEY_NODES.bridgeA, destination);
    } else {
      go(origin, destination);
    }

    // ─── How the session ends ───
    let endReason: SessionEndReason = 'USER';
    const r = rng.next();
    if (r < 0.12) {
      go(b.points.length > 0 ? nearestNode(model, b.pos) : origin, KEY_NODES.gate);
      endReason = 'GEOFENCE_EXIT';
    } else if (r < 0.16) {
      dwell(rng.range(60, 180));
      endReason = 'TIME_LIMIT';
    }

    if (b.points.length < 3) dwell(10);

    sessions.push({
      id: `syn-${dayKey}-${String(i).padStart(3, '0')}`,
      pseudoId: pseudonym(student.subject, dayKey),
      dayKey,
      mobility,
      startedAt: new Date(start),
      endedAt: new Date(b.t),
      endReason,
      points: b.points,
      events: b.events,
    });
  }

  return sessions;
}

function nearestNode(model: CampusModel, pos: { x: number; y: number; level: number }): string {
  let best = model.nodes[0]!;
  let bestD = Infinity;
  for (const n of model.nodes) {
    if (n.level !== pos.level) continue;
    const d = Math.hypot(n.x - pos.x, n.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best.id;
}

const round = (n: number): number => Math.round(n * 100) / 100;
