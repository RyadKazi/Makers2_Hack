/**
 * Route planning: up to two options ("fastest" with the user's constraints,
 * "step-free" with stairs excluded on top), metrics, steps, per-floor GeoJSON,
 * and an explanation when the constraints leave no route.
 */
import type { MobilityProfile } from '@prisma/client';
import type { Lang } from '../../lib/i18n.js';
import { activeConstraints, relax, violations, type ConstraintKey, type EffectiveConstraints } from './constraints.js';
import { edgeCostFor, type TravelMode } from './costs.js';
import type { CampusGraph, RoutingEdge, RoutingNode } from './graph.repository.js';
import { buildSteps, type Step } from './instructions.js';
import type { ResolvedLocation } from './locations.js';
import { findPath, orient, type FoundPath, type OrientedEdge } from './pathfinder.js';
import type { OptionId } from './routeStore.js';

// ───────────── speeds & ETA ─────────────

/** Comfortable speeds, m/s. */
export const WALKING_SPEED: Record<MobilityProfile, number> = {
  NONE: 1.3,
  DEAF_HARD_OF_HEARING: 1.3,
  SPEECH: 1.3,
  BLIND_LOW_VISION: 1.0,
  REDUCED_MOBILITY: 0.8,
  WHEELCHAIR: 1.3,
};
export const WHEELCHAIR_SPEED = 0.9;
export const ELEVATOR_WAIT_S = 30;
export const ELEVATOR_PER_LEVEL_S = 5;
const SECONDS_PER_STEP = 1.2;

export function travelSpeed(mode: TravelMode, walkingSpeedMs: number): number {
  return mode === 'wheelchair' ? WHEELCHAIR_SPEED : walkingSpeedMs;
}

export function etaSeconds(edges: readonly OrientedEdge[], mode: TravelMode, walkingSpeedMs: number): number {
  const speed = travelSpeed(mode, walkingSpeedMs);
  let total = 0;
  let inElevator = false;
  for (const { edge, from, to } of edges) {
    const vertical = from.level !== to.level;
    if (edge.isElevator && vertical) {
      total += (inElevator ? 0 : ELEVATOR_WAIT_S) + ELEVATOR_PER_LEVEL_S * Math.abs(to.level - from.level);
      inElevator = true;
      continue;
    }
    inElevator = false;
    if (vertical || edge.hasStairs) total += Math.max(edge.stepCount, 1) * SECONDS_PER_STEP;
    else if (edge.isRamp) total += edge.lengthM / (speed * 0.85);
    else total += (edge.lengthM / speed) * (mode === 'wheelchair' && edge.surface === 'GRAVEL' ? 1.4 : 1);
  }
  return Math.round(total);
}

/** Groups consecutive edges matching `pred` and counts the groups. */
function countGroups(edges: readonly OrientedEdge[], pred: (e: OrientedEdge) => boolean): number {
  let n = 0;
  let inside = false;
  for (const e of edges) {
    const match = pred(e);
    if (match && !inside) n += 1;
    inside = match;
  }
  return n;
}

// ───────────── localisation ─────────────

const OPTION_LABEL: Record<Lang, Record<OptionId, string>> = {
  fr: { fastest: 'Le plus rapide', 'step-free': 'Sans marches' },
  en: { fastest: 'Fastest', 'step-free': 'Step-free' },
  ar: { fastest: 'الأسرع', 'step-free': 'بدون درج' },
};

type BlockerText = (desc: string, value: string, limit: string) => string;
const BLOCKER: Record<Lang, Record<ConstraintKey, BlockerText> & { disconnected: string; combination: string }> = {
  fr: {
    closedPassages: (d, v) => `Le seul passage possible est fermé : ${d}${v ? ` (${v})` : ''}.`,
    avoidStairs: (d) => `Tous les itinéraires passent par des marches ou un escalier : ${d}.`,
    maxSlopePercent: (d, v, l) => `Pente trop forte : ${v} % pour ${l} % maximum (${d}).`,
    minDoorWidthCm: (d, v, l) => `Passage trop étroit : ${v} cm pour ${l} cm minimum (${d}).`,
    verifiedRampsOnly: (d) => `Seule une rampe non vérifiée y mène : ${d}.`,
    verifiedOnly: (d) => `Seul un passage non vérifié y mène : ${d}.`,
    avoidEdgeIds: (d) => `Le passage à éviter est indispensable : ${d}.`,
    disconnected: 'Aucun chemin ne relie ces deux points sur le plan.',
    combination: 'Plusieurs contraintes bloquent ensemble.',
  },
  en: {
    closedPassages: (d, v) => `The only possible way is closed: ${d}${v ? ` (${v})` : ''}.`,
    avoidStairs: (d) => `Every route uses steps or stairs: ${d}.`,
    maxSlopePercent: (d, v, l) => `Too steep: ${v} % for a ${l} % maximum (${d}).`,
    minDoorWidthCm: (d, v, l) => `Too narrow: ${v} cm for a ${l} cm minimum (${d}).`,
    verifiedRampsOnly: (d) => `Only an unverified ramp leads there: ${d}.`,
    verifiedOnly: (d) => `Only an unverified passage leads there: ${d}.`,
    avoidEdgeIds: (d) => `The passage you want to avoid is the only way: ${d}.`,
    disconnected: 'No path connects these two places on the map.',
    combination: 'Several constraints block it together.',
  },
  ar: {
    closedPassages: (d, v) => `الممر الوحيد الممكن مغلق: ${d}${v ? ` (${v})` : ''}.`,
    avoidStairs: (d) => `كل المسارات تمر بدرج أو درجات: ${d}.`,
    maxSlopePercent: (d, v, l) => `ميل شديد: ${v}٪ والحد الأقصى ${l}٪ (${d}).`,
    minDoorWidthCm: (d, v, l) => `ممر ضيق: ${v} سم والحد الأدنى ${l} سم (${d}).`,
    verifiedRampsOnly: (d) => `لا يؤدي إلى هناك إلا منحدر غير مُتحقَّق منه: ${d}.`,
    verifiedOnly: (d) => `لا يؤدي إلى هناك إلا ممر غير مُتحقَّق منه: ${d}.`,
    avoidEdgeIds: (d) => `الممر الذي تريد تجنبه ضروري: ${d}.`,
    disconnected: 'لا يوجد مسار يربط هاتين النقطتين على المخطط.',
    combination: 'عدة قيود تمنع المسار معًا.',
  },
};

const WARNING: Record<Lang, Record<'UNVERIFIED_RAMP' | 'ROUGH_SURFACE' | 'STEEP_SLOPE' | 'STAIRS', string>> = {
  fr: {
    UNVERIFIED_RAMP: 'Rampe non vérifiée sur le trajet',
    ROUGH_SURFACE: 'Revêtement irrégulier (gravier)',
    STEEP_SLOPE: 'Pente supérieure à 8 %',
    STAIRS: 'Le trajet comporte des marches',
  },
  en: { UNVERIFIED_RAMP: 'Unverified ramp on the way', ROUGH_SURFACE: 'Rough surface (gravel)', STEEP_SLOPE: 'Slope above 8 %', STAIRS: 'The route has steps' },
  ar: {
    UNVERIFIED_RAMP: 'منحدر غير مُتحقَّق منه في الطريق',
    ROUGH_SURFACE: 'سطح غير مستوٍ (حصى)',
    STEEP_SLOPE: 'ميل يتجاوز 8٪',
    STAIRS: 'المسار يحتوي على درجات',
  },
};

const NAMED_KINDS = new Set(['DOOR', 'ELEVATOR', 'STAIRS', 'ENTRANCE', 'RAMP']);

/** Human description of an edge from its end nodes (prefers doors, elevators, stairs…). */
export function describeEdge(graph: CampusGraph, edge: RoutingEdge): string {
  const ends = [graph.nodes.get(edge.toId), graph.nodes.get(edge.fromId)].filter((n): n is RoutingNode => !!n);
  const named = ends.find((n) => NAMED_KINDS.has(n.kind) && n.label) ?? ends.find((n) => n.label);
  return named?.label ?? edge.id;
}

// ───────────── DTOs ─────────────

export type Blocker = {
  constraint: ConstraintKey;
  message: string;
  edges: { edgeId: string; description: string; value: number | string | null; limit: number | string | null }[];
};

export type Unavailable = {
  option: OptionId;
  reason: 'CONSTRAINT' | 'COMBINATION' | 'DISCONNECTED';
  message: string;
  blockers: Blocker[];
};

export type FloorGeoJson = {
  floorId: string | null;
  level: number;
  buildingCode: string | null;
  featureCollection: { type: 'FeatureCollection'; features: unknown[] };
};

export type RouteOptionDto = {
  id: OptionId;
  label: string;
  stepFree: boolean;
  distanceM: number;
  etaSec: number;
  travelMode: TravelMode;
  elevatorCount: number;
  rampCount: number;
  stairsCount: number;
  levels: number[];
  constraints: EffectiveConstraints;
  prefilteredConstraints: string[];
  warnings: { code: string; message: string }[];
  nodeIds: string[];
  edgeIds: string[];
  steps: Step[];
  geojson: FloorGeoJson[];
};

export type PlanContext = {
  graph: CampusGraph;
  lang: Lang;
  mode: TravelMode;
  walkingSpeedMs: number;
  shoreline: boolean;
  from: ResolvedLocation;
  to: ResolvedLocation;
};

// ───────────── GeoJSON per floor ─────────────

function floorGeoJson(ctx: PlanContext, edges: readonly OrientedEdge[], steps: readonly Step[]): FloorGeoJson[] {
  const groups = new Map<string, FloorGeoJson>();
  const group = (node: RoutingNode): FloorGeoJson => {
    const key = node.floorId ?? 'outdoor';
    let g = groups.get(key);
    if (!g) {
      const floor = node.floorId ? ctx.graph.floors.get(node.floorId) : undefined;
      g = { floorId: node.floorId, level: node.level, buildingCode: floor?.buildingCode ?? null, featureCollection: { type: 'FeatureCollection', features: [] } };
      groups.set(key, g);
    }
    return g;
  };
  const stepOf = new Map<string, number>();
  for (const s of steps) for (const id of s.edgeIds) stepOf.set(id, s.index);

  const point = (n: RoutingNode, props: Record<string, unknown>) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [n.x, n.y] },
    properties: { nodeId: n.id, ...props },
  });

  const vertical = (e: OrientedEdge | undefined): boolean => !!e && e.from.level !== e.to.level;
  for (const [i, e] of edges.entries()) {
    const stepIndex = stepOf.get(e.edge.id) ?? null;
    if (vertical(e)) {
      // One marker where a ride / flight starts and one where it ends; floors passed through get none.
      const kind = e.edge.isElevator ? 'ELEVATOR' : 'STAIRS';
      let j = i;
      while (vertical(edges[j + 1])) j += 1;
      const end = edges[j]!.to;
      if (!vertical(edges[i - 1])) {
        group(e.from).featureCollection.features.push(point(e.from, { role: 'transition', kind, toLevel: end.level, stepIndex }));
        group(end).featureCollection.features.push(point(end, { role: 'transition', kind, fromLevel: e.from.level, stepIndex }));
      }
      continue;
    }
    const line = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[e.from.x, e.from.y], [e.to.x, e.to.y]] },
      properties: { edgeId: e.edge.id, kind: e.edge.hasStairs ? 'STEPS' : e.edge.isRamp ? 'RAMP' : 'WALK', stepIndex },
    };
    const targets = new Set([group(e.from), group(e.to)]); // thresholds appear outdoors and indoors
    for (const g of targets) g.featureCollection.features.push(line);
  }

  const nodes = edges.length ? [edges[0]!.from, edges.at(-1)!.to] : [ctx.graph.nodes.get(ctx.from.nodeId)!, ctx.graph.nodes.get(ctx.to.nodeId)!];
  group(nodes[0]!).featureCollection.features.push(point(nodes[0]!, { role: 'start', name: ctx.from.name }));
  group(nodes[1]!).featureCollection.features.push(point(nodes[1]!, { role: 'end', name: ctx.to.name }));

  return [...groups.values()];
}

// ───────────── options ─────────────

export function buildOption(ctx: PlanContext, id: OptionId, constraints: EffectiveConstraints, path: FoundPath): RouteOptionDto {
  const { nodes, edges } = orient(ctx.graph, path);
  const steps = buildSteps(nodes, edges, {
    lang: ctx.lang,
    shoreline: ctx.shoreline,
    destinationName: ctx.to.name,
    originName: ctx.from.name,
  });
  const distance = edges.reduce((sum, e) => sum + e.edge.lengthM, 0);

  const warnings: RouteOptionDto['warnings'] = [];
  const warn = (code: keyof (typeof WARNING)['fr']) => warnings.push({ code, message: WARNING[ctx.lang][code] });
  if (edges.some((e) => e.edge.isRamp && !e.edge.verified)) warn('UNVERIFIED_RAMP');
  if (edges.some((e) => e.edge.surface === 'GRAVEL')) warn('ROUGH_SURFACE');
  if (edges.some((e) => e.edge.slopePercent > 8)) warn('STEEP_SLOPE');
  const stepFree = !edges.some((e) => e.edge.hasStairs);
  if (!stepFree) warn('STAIRS');

  return {
    id,
    label: OPTION_LABEL[ctx.lang][id],
    stepFree,
    distanceM: Math.round(distance * 10) / 10,
    etaSec: etaSeconds(edges, ctx.mode, ctx.walkingSpeedMs),
    travelMode: ctx.mode,
    elevatorCount: countGroups(edges, (e) => e.edge.isElevator && e.from.level !== e.to.level),
    rampCount: countGroups(edges, (e) => e.edge.isRamp),
    stairsCount: countGroups(edges, (e) => e.edge.hasStairs),
    levels: [...new Set(nodes.map((n) => n.level))],
    constraints,
    prefilteredConstraints: path.prefiltered,
    warnings,
    nodeIds: path.nodeIds,
    edgeIds: path.edgeIds,
    steps,
    geojson: floorGeoJson(ctx, edges, steps),
  };
}

/** Why there is no route under `c`, by relaxing constraints one at a time. */
export function explainNoRoute(ctx: PlanContext, option: OptionId, c: EffectiveConstraints): Unavailable {
  const t = BLOCKER[ctx.lang];
  const cost = edgeCostFor(ctx.mode);
  const route = (cc: EffectiveConstraints) => findPath(ctx.graph, ctx.from.nodeId, ctx.to.nodeId, cc, cost);

  const blockersOn = (path: FoundPath, keys: readonly ConstraintKey[]): Blocker[] =>
    keys
      .map((k) => {
        const edges = path.edgeIds
          .map((id) => ctx.graph.edgeById.get(id)!)
          .flatMap((e) => violations(e, c).filter((v) => v.constraint === k).map((v) => ({ edgeId: e.id, description: describeEdge(ctx.graph, e), value: v.value, limit: v.limit })));
        const first = edges[0];
        return {
          constraint: k,
          message: first ? t[k](first.description, String(first.value ?? ''), String(first.limit ?? '')) : '',
          edges,
        };
      })
      .filter((b) => b.edges.length > 0);

  const active = activeConstraints(c);
  const single: Blocker[] = [];
  for (const k of active) {
    const path = route(relax(c, [k]));
    if (path) single.push(...blockersOn(path, [k]));
  }
  if (single.length) return { option, reason: 'CONSTRAINT', message: single.map((b) => b.message).join(' '), blockers: single };

  const relaxedAll = route(relax(c, active));
  if (relaxedAll) {
    const blockers = blockersOn(relaxedAll, active);
    return { option, reason: 'COMBINATION', message: [t.combination, ...blockers.map((b) => b.message)].join(' '), blockers };
  }
  return { option, reason: 'DISCONNECTED', message: t.disconnected, blockers: [] };
}

export type PlanResult = { options: { dto: RouteOptionDto; constraints: EffectiveConstraints }[]; unavailable: Unavailable[]; engine: string };

export function planOptions(ctx: PlanContext, base: EffectiveConstraints, wanted: readonly OptionId[]): PlanResult {
  const cost = edgeCostFor(ctx.mode);
  const candidates: { id: OptionId; c: EffectiveConstraints }[] = [];
  if (wanted.includes('fastest') && !base.avoidStairs) candidates.push({ id: 'fastest', c: base });
  if (wanted.includes('step-free') || base.avoidStairs) candidates.push({ id: 'step-free', c: { ...base, avoidStairs: true } });

  const options: PlanResult['options'] = [];
  const unavailable: Unavailable[] = [];
  let engine = '';
  for (const { id, c } of candidates) {
    const path = findPath(ctx.graph, ctx.from.nodeId, ctx.to.nodeId, c, cost);
    if (!path) {
      unavailable.push(explainNoRoute(ctx, id, c));
      continue;
    }
    engine = path.engine;
    // The fastest route may already be step-free: no need for a duplicate option.
    const duplicate = options.find((o) => o.dto.edgeIds.join() === path.edgeIds.join());
    if (duplicate) continue;
    options.push({ dto: buildOption(ctx, id, c, path), constraints: c });
  }
  return { options, unavailable, engine };
}
