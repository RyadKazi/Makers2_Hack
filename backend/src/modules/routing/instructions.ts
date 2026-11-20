/**
 * Turn-by-turn instructions (AR / FR / EN) from a path. Pure: no I/O.
 *
 * Edges are grouped into runs (straight walking, ramp, steps, elevator ride,
 * stair flight). A new run starts at a turn (> 25°), a change of kind, a change
 * of the wall to follow, or when entering / leaving a building.
 *
 * Geometry: x → east, y → north, so a positive heading change (counter-clockwise)
 * is a LEFT turn for the walker. wallSide is stored relative to the edge's
 * from → to direction and is flipped when the edge is walked backwards.
 */
import type { Lang } from '../../lib/i18n.js';
import type { WallSide } from './graph.repository.js';
import type { OrientedEdge } from './pathfinder.js';
import type { RoutingNode } from './graph.repository.js';

export type Turn = 'STRAIGHT' | 'SLIGHT_LEFT' | 'LEFT' | 'SHARP_LEFT' | 'SLIGHT_RIGHT' | 'RIGHT' | 'SHARP_RIGHT' | 'U_TURN';
export type StepType = 'START' | 'WALK' | 'RAMP' | 'STEPS' | 'ELEVATOR' | 'STAIRS' | 'ENTER' | 'EXIT' | 'ARRIVE';

export type Shoreline = {
  side: 'LEFT' | 'RIGHT' | 'BOTH';
  /** Walls indoors, curbs / grass edges / railings outdoors. */
  feature: 'WALL' | 'EDGE';
  distanceM: number;
  /** Typical lateral distance to the wall or edge, metres. */
  offsetM: number | null;
  /** Free-text hint from the map data (French). */
  hint: string | null;
};

export type Step = {
  index: number;
  type: StepType;
  instruction: string;
  distanceM: number;
  turn: Turn | null;
  fromNodeId: string;
  toNodeId: string;
  edgeIds: string[];
  level: number;
  toLevel: number | null;
  floorId: string | null;
  x: number;
  y: number;
  landmark: string | null;
  shoreline: Shoreline | null;
};

export type InstructionOptions = {
  lang: Lang;
  /** Add "keep the wall on your left…" sentences (blind / low-vision users). */
  shoreline: boolean;
  destinationName: string;
  originName: string | null;
};

type RunKind = 'WALK' | 'RAMP' | 'STEPS' | 'ELEVATOR' | 'STAIRS';
type Run = { kind: RunKind; edges: OrientedEdge[]; turn: Turn; side: WallSide };

// ───────────── geometry ─────────────

const heading = (a: RoutingNode, b: RoutingNode): number => Math.atan2(b.y - a.y, b.x - a.x);

export function turnBetween(prev: OrientedEdge, next: OrientedEdge): Turn {
  let delta = ((heading(next.from, next.to) - heading(prev.from, prev.to)) * 180) / Math.PI;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  const a = Math.abs(delta);
  if (a < 25) return 'STRAIGHT';
  if (a >= 160) return 'U_TURN';
  const left = delta > 0;
  if (a < 60) return left ? 'SLIGHT_LEFT' : 'SLIGHT_RIGHT';
  if (a < 120) return left ? 'LEFT' : 'RIGHT';
  return left ? 'SHARP_LEFT' : 'SHARP_RIGHT';
}

/** Wall side from the walker's point of view. */
export function walkerWallSide(e: OrientedEdge): WallSide {
  const side = e.edge.wallSide;
  if (!e.reversed || side === 'BOTH' || side === 'NONE') return side;
  return side === 'LEFT' ? 'RIGHT' : 'LEFT';
}

const isVertical = (e: OrientedEdge): boolean => e.from.level !== e.to.level;

function kindOf(e: OrientedEdge): RunKind {
  if (isVertical(e)) return e.edge.isElevator ? 'ELEVATOR' : 'STAIRS';
  if (e.edge.hasStairs) return 'STEPS';
  if (e.edge.isRamp) return 'RAMP';
  return 'WALK';
}

const indoor = (n: RoutingNode): boolean => n.floorId !== null;

function buildRuns(edges: readonly OrientedEdge[], shoreline: boolean): Run[] {
  const runs: Run[] = [];
  for (const [i, e] of edges.entries()) {
    const kind = kindOf(e);
    const side = walkerWallSide(e);
    const prev = edges[i - 1];
    const current = runs.at(-1);
    const turn = prev && !isVertical(prev) && !isVertical(e) ? turnBetween(prev, e) : 'STRAIGHT';
    const crossesThreshold = prev !== undefined && indoor(prev.from) !== indoor(prev.to);
    const sameRun =
      current !== undefined &&
      current.kind === kind &&
      !crossesThreshold &&
      (kind === 'ELEVATOR' || kind === 'STAIRS' || (turn === 'STRAIGHT' && (!shoreline || current.side === side)));
    if (sameRun) current.edges.push(e);
    else runs.push({ kind, edges: [e], turn, side });
  }
  return runs;
}

// ───────────── wording ─────────────

const round = (m: number): number => Math.max(1, Math.round(m));

type Phrases = {
  turn: Record<Exclude<Turn, 'STRAIGHT'>, string>;
  walk: (m: number) => string;
  toward: (place: string) => string;
  ramp: (m: number, slope: number) => string;
  steps: (n: number) => string;
  elevator: (level: string) => string;
  stairs: (up: boolean, level: string, n: number) => string;
  level: (n: number) => string;
  enter: (place: string) => string;
  exit: (place: string) => string;
  start: (place: string) => string;
  arrive: (place: string) => string;
  shoreline: (side: 'LEFT' | 'RIGHT' | 'BOTH', feature: 'WALL' | 'EDGE', m: number) => string;
  then: (first: string, second: string) => string;
};

const PHRASES: Record<Lang, Phrases> = {
  fr: {
    turn: {
      SLIGHT_LEFT: 'Légèrement à gauche',
      LEFT: 'Tournez à gauche',
      SHARP_LEFT: 'Tournez franchement à gauche',
      SLIGHT_RIGHT: 'Légèrement à droite',
      RIGHT: 'Tournez à droite',
      SHARP_RIGHT: 'Tournez franchement à droite',
      U_TURN: 'Faites demi-tour',
    },
    walk: (m) => `avancez tout droit sur ${m} m`,
    toward: (p) => ` jusqu’à ${p}`,
    ramp: (m, s) => `empruntez la rampe sur ${m} m (pente ${s} %)`,
    steps: (n) => `franchissez ${n} marche${n > 1 ? 's' : ''}`,
    elevator: (l) => `Prenez l’ascenseur jusqu’au ${l}`,
    stairs: (up, l, n) => `${up ? 'Montez' : 'Descendez'} l’escalier jusqu’au ${l} (${n} marches)`,
    level: (n) => (n === 0 ? 'rez-de-chaussée' : `${n}${n === 1 ? 'er' : 'e'} étage`),
    enter: (p) => `Entrez dans le bâtiment : ${p}`,
    exit: (p) => `Sortez du bâtiment : ${p}`,
    start: (p) => `Départ : ${p}`,
    arrive: (p) => `Vous êtes arrivé : ${p}`,
    shoreline: (side, f, m) =>
      side === 'BOTH'
        ? `${f === 'WALL' ? 'Murs' : 'Bordures'} des deux côtés sur ${m} m`
        : `Gardez ${f === 'WALL' ? 'le mur' : 'la bordure'} à votre ${side === 'LEFT' ? 'gauche' : 'droite'} sur ${m} m`,
    then: (a, b) => `${a}, puis ${b}`,
  },
  en: {
    turn: {
      SLIGHT_LEFT: 'Bear left',
      LEFT: 'Turn left',
      SHARP_LEFT: 'Turn sharp left',
      SLIGHT_RIGHT: 'Bear right',
      RIGHT: 'Turn right',
      SHARP_RIGHT: 'Turn sharp right',
      U_TURN: 'Turn around',
    },
    walk: (m) => `go straight for ${m} m`,
    toward: (p) => ` to ${p}`,
    ramp: (m, s) => `take the ramp for ${m} m (${s} % slope)`,
    steps: (n) => `go over ${n} step${n > 1 ? 's' : ''}`,
    elevator: (l) => `Take the elevator to the ${l}`,
    stairs: (up, l, n) => `Take the stairs ${up ? 'up' : 'down'} to the ${l} (${n} steps)`,
    level: (n) => (n === 0 ? 'ground floor' : `floor ${n}`),
    enter: (p) => `Enter the building: ${p}`,
    exit: (p) => `Leave the building: ${p}`,
    start: (p) => `Start: ${p}`,
    arrive: (p) => `You have arrived: ${p}`,
    shoreline: (side, f, m) =>
      side === 'BOTH'
        ? `${f === 'WALL' ? 'Walls' : 'Edges'} on both sides for ${m} m`
        : `Keep the ${f === 'WALL' ? 'wall' : 'edge'} on your ${side === 'LEFT' ? 'left' : 'right'} for ${m} m`,
    then: (a, b) => `${a}, then ${b}`,
  },
  ar: {
    turn: {
      SLIGHT_LEFT: 'انحرف قليلًا إلى اليسار',
      LEFT: 'انعطف يسارًا',
      SHARP_LEFT: 'انعطف بحدّة إلى اليسار',
      SLIGHT_RIGHT: 'انحرف قليلًا إلى اليمين',
      RIGHT: 'انعطف يمينًا',
      SHARP_RIGHT: 'انعطف بحدّة إلى اليمين',
      U_TURN: 'استدر إلى الخلف',
    },
    walk: (m) => `امشِ مستقيمًا لمسافة ${m} م`,
    toward: (p) => ` حتى ${p}`,
    ramp: (m, s) => `استخدم المنحدر لمسافة ${m} م (ميل ${s}٪)`,
    steps: (n) => `اجتز ${n} ${n > 2 && n < 11 ? 'درجات' : 'درجة'}`,
    elevator: (l) => `استقل المصعد إلى ${l}`,
    stairs: (up, l, n) => `${up ? 'اصعد' : 'انزل'} الدرج إلى ${l} (${n} درجة)`,
    level: (n) => (n === 0 ? 'الطابق الأرضي' : `الطابق ${n}`),
    enter: (p) => `ادخل المبنى: ${p}`,
    exit: (p) => `اخرج من المبنى: ${p}`,
    start: (p) => `نقطة الانطلاق: ${p}`,
    arrive: (p) => `لقد وصلت: ${p}`,
    shoreline: (side, f, m) =>
      side === 'BOTH'
        ? `${f === 'WALL' ? 'جدران' : 'حواف'} على الجانبين لمسافة ${m} م`
        : `أبقِ ${f === 'WALL' ? 'الجدار' : 'الحافة'} على ${side === 'LEFT' ? 'يسارك' : 'يمينك'} لمسافة ${m} م`,
    then: (a, b) => `${a}، ثم ${b}`,
  },
};

const capitalise = (s: string): string => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Name of a point to aim for: spoken landmark first, then label. */
const placeName = (n: RoutingNode): string | null => n.landmark ?? n.label;

// ───────────── generator ─────────────

export function buildSteps(nodes: readonly RoutingNode[], edges: readonly OrientedEdge[], opts: InstructionOptions): Step[] {
  const p = PHRASES[opts.lang];
  const steps: Omit<Step, 'index'>[] = [];
  const first = nodes[0]!;
  const last = nodes.at(-1)!;

  steps.push({
    type: 'START',
    instruction: p.start(opts.originName ?? placeName(first) ?? first.id),
    distanceM: 0,
    turn: null,
    fromNodeId: first.id,
    toNodeId: first.id,
    edgeIds: [],
    level: first.level,
    toLevel: null,
    floorId: first.floorId,
    x: first.x,
    y: first.y,
    landmark: first.landmark,
    shoreline: null,
  });

  for (const run of buildRuns(edges, opts.shoreline)) {
    const a = run.edges[0]!.from;
    const b = run.edges.at(-1)!.to;
    const distance = run.edges.reduce((sum, e) => sum + e.edge.lengthM, 0);
    const m = round(distance);
    const target = b.id === last.id ? null : placeName(b);
    const lead = run.turn !== 'STRAIGHT' ? p.turn[run.turn] : null;
    const withLead = (action: string): string => (lead ? p.then(lead, action) : capitalise(action));

    let instruction: string;
    switch (run.kind) {
      case 'WALK':
        instruction = withLead(p.walk(m) + (target ? p.toward(target) : ''));
        break;
      case 'RAMP':
        instruction = withLead(p.ramp(m, Math.max(...run.edges.map((e) => e.edge.slopePercent))));
        break;
      case 'STEPS':
        instruction = withLead(p.steps(run.edges.reduce((n, e) => n + Math.max(1, e.edge.stepCount), 0)));
        break;
      case 'ELEVATOR':
        instruction = p.elevator(p.level(b.level));
        break;
      case 'STAIRS':
        instruction = p.stairs(b.level > a.level, p.level(b.level), run.edges.reduce((n, e) => n + e.edge.stepCount, 0));
        break;
    }

    let shoreline: Shoreline | null = null;
    if ((run.kind === 'WALK' || run.kind === 'RAMP' || run.kind === 'STAIRS') && (run.side === 'LEFT' || run.side === 'RIGHT' || run.side === 'BOTH')) {
      const feature = run.edges.every((e) => indoor(e.from) || indoor(e.to)) ? 'WALL' : 'EDGE';
      const offsets = run.edges.map((e) => e.edge.wallDistanceM).filter((d): d is number => d !== null);
      shoreline = {
        side: run.side,
        feature,
        distanceM: m,
        offsetM: offsets.length ? Math.min(...offsets) : null,
        hint: run.edges.find((e) => e.edge.shorelineHint)?.edge.shorelineHint ?? null,
      };
      if (opts.shoreline) instruction += `. ${p.shoreline(shoreline.side, feature, m)}`;
    }

    steps.push({
      type: run.kind,
      instruction,
      distanceM: Math.round(distance * 10) / 10,
      turn: run.kind === 'WALK' || run.kind === 'RAMP' || run.kind === 'STEPS' ? run.turn : null,
      fromNodeId: a.id,
      toNodeId: b.id,
      edgeIds: run.edges.map((e) => e.edge.id),
      level: a.level,
      toLevel: a.level !== b.level ? b.level : null,
      floorId: a.floorId ?? b.floorId,
      x: a.x,
      y: a.y,
      landmark: b.landmark,
      shoreline,
    });

    // Crossing a building threshold at the end of this run
    const lastEdge = run.edges.at(-1)!;
    if (indoor(lastEdge.from) !== indoor(lastEdge.to)) {
      const entering = indoor(lastEdge.to);
      const door = entering ? lastEdge.to : lastEdge.from;
      const name = door.label ?? door.landmark ?? door.id;
      steps.push({
        type: entering ? 'ENTER' : 'EXIT',
        instruction: entering ? p.enter(name) : p.exit(name),
        distanceM: 0,
        turn: null,
        fromNodeId: b.id,
        toNodeId: b.id,
        edgeIds: [],
        level: b.level,
        toLevel: null,
        floorId: b.floorId,
        x: b.x,
        y: b.y,
        landmark: door.landmark,
        shoreline: null,
      });
    }
  }

  steps.push({
    type: 'ARRIVE',
    instruction: p.arrive(opts.destinationName),
    distanceM: 0,
    turn: null,
    fromNodeId: last.id,
    toNodeId: last.id,
    edgeIds: [],
    level: last.level,
    toLevel: null,
    floorId: last.floorId,
    x: last.x,
    y: last.y,
    landmark: last.landmark,
    shoreline: null,
  });

  return steps.map((s, index) => ({ index, ...s }));
}
