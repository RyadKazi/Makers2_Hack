/**
 * Route geometry and progress. Pure: no React, no I/O.
 *
 * The API returns, per floor, one LineString per edge (stored in the edge's own
 * direction) and Points for floor transitions. buildTrack() chains them into one
 * ordered polyline in walking order, with the cumulative distance d at every vertex.
 * Elevator and stair rides are vertical segments: same x/y, the level changes.
 */
import type { RouteOption, RouteStep } from '@/api/types';

export type XY = { x: number; y: number };
export type Place3D = XY & { level: number; floorId: string | null };

export type TrackPoint = Place3D & {
  /** Distance from the start, metres. */
  d: number;
  /** Step of the segment that ENDS at this point. */
  stepIndex: number;
  /** The segment ending here is an elevator / stair ride. */
  vertical?: 'ELEVATOR' | 'STAIRS';
};

export type Track = {
  points: TrackPoint[];
  total: number;
  /** stepStart[i] = distance at which step i begins. */
  stepStart: number[];
  steps: RouteStep[];
};

type LineFeature = { type: 'Feature'; geometry: { type: 'LineString'; coordinates: [number, number][] }; properties: { edgeId: string; kind: string; stepIndex: number } };
type PointFeature = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { role?: string; stepIndex?: number; fromLevel?: number; toLevel?: number; kind?: string } };

const dist = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);

export function buildTrack(option: RouteOption, from: Place3D): Track {
  const lines = new Map<string, { coords: [number, number][]; floorId: string | null; level: number; stepIndex: number }>();
  const arrivals: (XY & { floorId: string | null; level: number; stepIndex: number })[] = [];
  for (const floor of option.geojson) {
    for (const raw of floor.featureCollection.features) {
      const f = raw as LineFeature | PointFeature;
      if (f.geometry.type === 'LineString') {
        const lf = f as LineFeature;
        lines.set(lf.properties.edgeId, { coords: lf.geometry.coordinates, floorId: floor.floorId, level: floor.level, stepIndex: lf.properties.stepIndex });
      } else {
        const pf = f as PointFeature;
        if (pf.properties.role === 'transition' && pf.properties.fromLevel !== undefined && pf.properties.stepIndex !== undefined) {
          arrivals.push({ x: pf.geometry.coordinates[0], y: pf.geometry.coordinates[1], floorId: floor.floorId, level: floor.level, stepIndex: pf.properties.stepIndex });
        }
      }
    }
  }
  const stepOfEdge = new Map<string, RouteStep>();
  for (const s of option.steps) for (const e of s.edgeIds) stepOfEdge.set(e, s);

  const firstMoving = option.steps.find((s) => s.type !== 'START')?.index ?? 0;
  const points: TrackPoint[] = [{ ...from, d: 0, stepIndex: firstMoving }];
  let cursor: TrackPoint = points[0]!;
  const push = (p: Omit<TrackPoint, 'd'>, extra = 0) => {
    const d = cursor.d + (p.vertical ? extra : dist(cursor, p));
    if (!p.vertical && dist(cursor, p) < 0.01 && p.level === cursor.level) return;
    cursor = { ...p, d };
    points.push(cursor);
  };

  option.edgeIds.forEach((edgeId, i) => {
    const line = lines.get(edgeId);
    if (line) {
      let coords = line.coords;
      const first = { x: coords[0]![0], y: coords[0]![1] };
      const last = { x: coords.at(-1)![0], y: coords.at(-1)![1] };
      if (dist(cursor, last) < dist(cursor, first)) coords = [...coords].reverse();
      for (const [x, y] of coords) push({ x, y, level: line.level, floorId: line.floorId, stepIndex: line.stepIndex });
      return;
    }
    // Vertical edge: jump to the arrival transition once the ride (possibly several edges) ends.
    const step = stepOfEdge.get(edgeId);
    if (!step) return;
    const nextEdge = option.edgeIds[i + 1];
    if (nextEdge !== undefined && stepOfEdge.get(nextEdge) === step && !lines.has(nextEdge)) return;
    const arrival = arrivals.find((a) => a.stepIndex === step.index) ?? { x: cursor.x, y: cursor.y, floorId: null, level: step.toLevel ?? cursor.level };
    const kind = step.type === 'ELEVATOR' ? 'ELEVATOR' : 'STAIRS';
    push({ x: arrival.x, y: arrival.y, level: arrival.level, floorId: arrival.floorId, stepIndex: step.index, vertical: kind }, step.distanceM);
  });

  const total = cursor.d;
  const stepStart: number[] = [];
  let lastStart = 0;
  for (const s of option.steps) {
    let start: number;
    if (s.type === 'START') start = 0;
    else if (s.type === 'ARRIVE') start = total;
    else {
      const i = points.findIndex((p, k) => k > 0 && p.stepIndex === s.index);
      start = i > 0 ? points[i - 1]!.d : lastStart;
    }
    start = Math.max(start, lastStart);
    stepStart[s.index] = start;
    lastStart = start;
  }
  return { points, total, stepStart, steps: option.steps };
}

/** Position at distance d along the track (vertical rides switch level half-way). */
export function positionAt(track: Track, d: number): Place3D & { stepIndex: number } {
  const pts = track.points;
  const clamped = Math.max(0, Math.min(d, track.total));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (clamped <= b.d) {
      const span = b.d - a.d || 1;
      const k = (clamped - a.d) / span;
      const upper = k >= 0.5 ? b : a;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, level: b.vertical ? upper.level : b.level, floorId: b.vertical ? upper.floorId : b.floorId, stepIndex: b.stepIndex };
    }
  }
  const last = pts.at(-1)!;
  return { x: last.x, y: last.y, level: last.level, floorId: last.floorId, stepIndex: last.stepIndex };
}

export type Located = { d: number; offRouteM: number };

/**
 * Projects a position on the track, on the same level only (null: another floor).
 * hintD (the previous progress) breaks ties when the route passes the same spot twice.
 */
export function locate(track: Track, pos: Place3D, hintD: number | null = null): Located | null {
  const found: { best: (Located & { cost: number }) | null } = { best: null };
  const consider = (d: number, off: number) => {
    const cost = off + (hintD === null ? 0 : Math.max(0, Math.abs(d - hintD) - 15) * 0.2);
    if (!found.best || cost < found.best.cost) found.best = { d, offRouteM: off, cost };
  };
  const pts = track.points;
  if (pts.length === 1 && pts[0]!.level === pos.level) consider(0, dist(pts[0]!, pos));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (b.vertical) {
      if (b.level === pos.level) consider(b.d, dist(b, pos));
      if (a.level === pos.level) consider(a.d, dist(a, pos));
      continue;
    }
    if (b.level !== pos.level) continue;
    const len = dist(a, b);
    const k = len === 0 ? 0 : Math.max(0, Math.min(1, ((pos.x - a.x) * (b.x - a.x) + (pos.y - a.y) * (b.y - a.y)) / (len * len)));
    const px = a.x + (b.x - a.x) * k;
    const py = a.y + (b.y - a.y) * k;
    consider(a.d + len * k, Math.hypot(pos.x - px, pos.y - py));
  }
  if (!found.best) return null;
  return { d: found.best.d, offRouteM: found.best.offRouteM };
}

/** Step being walked at distance d (never START once moving; ARRIVE only at the end). */
export function stepIndexAt(track: Track, d: number): number {
  const steps = track.steps;
  let current = steps.find((s) => s.type !== 'START')?.index ?? 0;
  for (const s of steps) {
    if (s.type === 'START') continue;
    if (s.type === 'ARRIVE') {
      if (d >= track.total - 0.5) current = s.index;
      continue;
    }
    if ((track.stepStart[s.index] ?? Infinity) <= d + 0.5) current = s.index;
  }
  return current;
}

/** Metres left until the next step starts (or until the destination). */
export function metresToNextStep(track: Track, stepIndex: number, d: number): number {
  const next = track.stepStart[stepIndex + 1];
  return Math.max(0, (next ?? track.total) - d);
}

/** Splits the track at d into walked / remaining polylines for one floor (null = outdoors). */
export function splitForFloor(track: Track, d: number, floorKey: { level: number; floorId: string | null; outdoors?: boolean }): { done: XY[][]; todo: XY[][] } {
  const done: XY[][] = [];
  const todo: XY[][] = [];
  const onFloor = (p: TrackPoint) => (floorKey.outdoors ? p.floorId === null : p.floorId === floorKey.floorId || (p.floorId === null && p.level === floorKey.level));
  let current: XY[] | null = null;
  let bucket: 'done' | 'todo' | null = null;
  const flush = () => {
    if (current && current.length > 1) (bucket === 'done' ? done : todo).push(current);
    current = null;
    bucket = null;
  };
  const pts = track.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (b.vertical || !onFloor(b) || !onFloor(a)) {
      flush();
      continue;
    }
    const pieces: { from: XY; to: XY; kind: 'done' | 'todo' }[] = [];
    if (b.d <= d) pieces.push({ from: a, to: b, kind: 'done' });
    else if (a.d >= d) pieces.push({ from: a, to: b, kind: 'todo' });
    else {
      const k = (d - a.d) / (b.d - a.d);
      const mid = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      pieces.push({ from: a, to: mid, kind: 'done' }, { from: mid, to: b, kind: 'todo' });
    }
    for (const p of pieces) {
      if (bucket !== p.kind) {
        flush();
        bucket = p.kind;
        current = [{ x: p.from.x, y: p.from.y }];
      }
      current!.push({ x: p.to.x, y: p.to.y });
    }
  }
  flush();
  return { done, todo };
}

/** Floor transitions (elevator / stairs) visible on a floor, with the level reached. */
export function transitionsOnFloor(track: Track, floorId: string | null): (XY & { kind: 'ELEVATOR' | 'STAIRS'; toLevel: number; stepIndex: number })[] {
  const out: (XY & { kind: 'ELEVATOR' | 'STAIRS'; toLevel: number; stepIndex: number })[] = [];
  const pts = track.points;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (!b.vertical) continue;
    const a = pts[i - 1]!;
    if (a.floorId === floorId) out.push({ x: a.x, y: a.y, kind: b.vertical, toLevel: b.level, stepIndex: b.stepIndex });
    if (b.floorId === floorId) out.push({ x: b.x, y: b.y, kind: b.vertical, toLevel: a.level, stepIndex: b.stepIndex });
  }
  return out;
}

// ───────────── announcements ─────────────

export const PRE_ANNOUNCE_M = 12;
export const AT_DECISION_M = 3;

export type Cue = { key: string; kind: 'pre' | 'at'; step: RouteStep; metres: number };

/**
 * Cues due at distance d: a pre-announcement about 12 m before the next decision point,
 * then the instruction itself when reaching it. `said` holds keys already spoken.
 */
export function dueCues(track: Track, d: number, said: ReadonlySet<string>, version: number): Cue[] {
  const cues: Cue[] = [];
  for (const s of track.steps) {
    if (s.type === 'START') continue;
    const start = track.stepStart[s.index] ?? 0;
    const ahead = start - d;
    if (ahead < -AT_DECISION_M) continue;
    const at = `${version}:${s.index}:at`;
    const pre = `${version}:${s.index}:pre`;
    if (ahead <= AT_DECISION_M) {
      if (!said.has(at)) {
        cues.push({ key: at, kind: 'at', step: s, metres: Math.max(0, ahead) });
        break; // one decision point at a time: the next one is pre-announced on a later update
      }
      continue;
    }
    if (ahead <= PRE_ANNOUNCE_M && !said.has(pre) && !said.has(at)) cues.push({ key: pre, kind: 'pre', step: s, metres: ahead });
    break; // only the next decision point
  }
  return cues;
}

/** Vibration: 1 long buzz = left, 2 short = right, 3 short = change floor / arrive. */
export function vibrationFor(step: RouteStep): number[] | null {
  if (step.type === 'ELEVATOR' || step.type === 'STAIRS' || step.type === 'ARRIVE') return [120, 80, 120, 80, 120];
  const turn = step.turn ?? 'STRAIGHT';
  if (turn.includes('LEFT')) return [400];
  if (turn.includes('RIGHT')) return [120, 100, 120];
  if (turn === 'U_TURN') return [400, 120, 400];
  return null;
}

/** First step of a new route that differs from the old one and names a way through (ramp, elevator, landmark). */
export function viaOf(newRoute: RouteOption, oldEdgeIds: readonly string[]): RouteStep | null {
  const old = new Set(oldEdgeIds);
  const fresh = newRoute.steps.filter((s) => s.edgeIds.some((e) => !old.has(e)));
  return (
    fresh.find((s) => s.type === 'RAMP' || s.type === 'ELEVATOR') ??
    fresh.find((s) => s.landmark !== null && s.type !== 'ARRIVE') ??
    null
  );
}
