import type { MobilityProfile } from '@prisma/client';
import { HttpError } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import type { Lang } from '../../lib/i18n.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthUser } from '../../middleware/auth.js';
import { edgeAllowed, mergeConstraints, type ConstraintsInput } from './constraints.js';
import { edgeCostFor, type TravelMode } from './costs.js';
import { activeEngine } from './engine/index.js';
import { getCampusGraph, type CampusGraph } from './graph.repository.js';
import { resolveLocation, snapToGraph, MAX_SNAP_M, type LocationInput, type ResolvedLocation } from './locations.js';
import { findPath, orient } from './pathfinder.js';
import { buildOption, describeEdge, explainNoRoute, planOptions, WALKING_SPEED, type PlanContext, type RouteOptionDto, type Unavailable } from './planner.js';
import { trackProgress } from './progress.js';
import { getRoute, routesUsingEdge, saveRoute, type OptionId, type StoredRoute } from './routeStore.js';

export type PlanInput = {
  from: LocationInput;
  to: LocationInput;
  constraints?: (ConstraintsInput & { useProfile?: boolean | undefined }) | undefined;
  mode?: TravelMode | undefined;
  options?: OptionId[] | undefined;
  shorelineHints?: boolean | undefined;
};

export type PlanResponse = {
  routeId: string | null;
  version: number;
  engine: string;
  from: ResolvedLocation;
  to: ResolvedLocation;
  travelMode: TravelMode;
  options: RouteOptionDto[];
  unavailable: Unavailable[];
};

async function loadProfile(user: AuthUser | undefined) {
  if (!user) return null;
  return prisma.accessibilityProfile.findUnique({ where: { userId: user.id } });
}

export async function planRoute(input: PlanInput, user: AuthUser | undefined, lang: Lang): Promise<PlanResponse> {
  const graph = await getCampusGraph();
  const useProfile = input.constraints?.useProfile ?? true;
  const profile = useProfile ? await loadProfile(user) : null;
  const constraints = mergeConstraints(profile, input.constraints);
  const mobility: MobilityProfile = profile?.mobility ?? 'NONE';
  const mode: TravelMode = input.mode ?? (mobility === 'WHEELCHAIR' ? 'wheelchair' : 'walking');
  const walkingSpeedMs = WALKING_SPEED[mobility];
  const shoreline = input.shorelineHints ?? profile?.shorelineHints ?? false;

  const [from, to] = await Promise.all([resolveLocation(graph, input.from, 'from'), resolveLocation(graph, input.to, 'to')]);
  const ctx: PlanContext = { graph, lang, mode, walkingSpeedMs, shoreline, from, to };
  const result = planOptions(ctx, constraints, input.options ?? ['fastest', 'step-free']);

  let routeId: string | null = null;
  if (result.options.length > 0) {
    const stored = saveRoute({
      lang,
      mode,
      walkingSpeedMs,
      shoreline,
      from,
      to,
      options: new Map(result.options.map((o) => [o.dto.id, { id: o.dto.id, constraints: o.constraints, nodeIds: o.dto.nodeIds, edgeIds: o.dto.edgeIds }])),
    });
    routeId = stored.id;
  }

  return {
    routeId,
    version: 1,
    engine: activeEngine.id,
    from,
    to,
    travelMode: mode,
    options: result.options.map((o) => o.dto),
    unavailable: result.unavailable,
  };
}

// ───────────── recheck ─────────────

export type RecheckInput = {
  position: { x: number; y: number; level: number; floorId?: string | undefined; accuracyM?: number | undefined };
  option?: OptionId | undefined;
};

export type RecheckStatus = 'ON_ROUTE' | 'ARRIVED' | 'REROUTED' | 'NO_ROUTE';
export type RecheckReason = 'OFF_ROUTE' | 'EDGE_CLOSED' | 'WRONG_FLOOR';

export type RecheckResponse = {
  routeId: string;
  version: number;
  option: OptionId;
  status: RecheckStatus;
  reason: RecheckReason | null;
  message: string;
  distanceFromRouteM: number | null;
  progress: { completedM: number; remainingM: number; nextStepIndex: number | null } | null;
  blockedEdge: { edgeId: string; description: string; closedReason: string | null } | null;
  route: RouteOptionDto | null;
  unavailable: Unavailable | null;
};

export const OFF_ROUTE_MIN_M = 8;
export const ARRIVAL_RADIUS_M = 5;

const MESSAGES: Record<Lang, { onRoute: string; arrived: string; rerouted: Record<RecheckReason, (place: string) => string> }> = {
  fr: {
    onRoute: 'Vous êtes sur le bon chemin.',
    arrived: 'Vous êtes arrivé.',
    rerouted: {
      OFF_ROUTE: () => 'Vous vous êtes écarté de l’itinéraire : nouvel itinéraire calculé.',
      WRONG_FLOOR: () => 'Vous n’êtes pas au bon étage : nouvel itinéraire calculé.',
      EDGE_CLOSED: (p) => `Passage fermé sur votre itinéraire (${p}) : nouvel itinéraire calculé.`,
    },
  },
  en: {
    onRoute: 'You are on the right way.',
    arrived: 'You have arrived.',
    rerouted: {
      OFF_ROUTE: () => 'You left the route: new route calculated.',
      WRONG_FLOOR: () => 'You are on another floor: new route calculated.',
      EDGE_CLOSED: (p) => `A passage on your route is closed (${p}): new route calculated.`,
    },
  },
  ar: {
    onRoute: 'أنت على الطريق الصحيح.',
    arrived: 'لقد وصلت.',
    rerouted: {
      OFF_ROUTE: () => 'ابتعدت عن المسار: تم حساب مسار جديد.',
      WRONG_FLOOR: () => 'أنت في طابق آخر: تم حساب مسار جديد.',
      EDGE_CLOSED: (p) => `ممر مغلق على مسارك (${p}): تم حساب مسار جديد.`,
    },
  },
};

function contextFor(route: StoredRoute, graph: CampusGraph, lang: Lang, from: ResolvedLocation): PlanContext {
  return { graph, lang, mode: route.mode, walkingSpeedMs: route.walkingSpeedMs, shoreline: route.shoreline, from, to: route.to };
}

export async function recheckRoute(routeId: string, input: RecheckInput, lang: Lang): Promise<RecheckResponse> {
  const route = getRoute(routeId);
  if (!route) throw new HttpError(404, 'ROUTE_NOT_FOUND', 'Route not found or expired: plan a new one');
  const optionId = input.option ?? (route.options.keys().next().value as OptionId);
  const option = route.options.get(optionId);
  if (!option) throw new HttpError(400, 'UNKNOWN_OPTION', `This route has no "${optionId}" option`);

  const graph = await getCampusGraph();
  const t = MESSAGES[lang];
  const { position } = input;
  const base = { routeId, option: optionId, blockedEdge: null, route: null, unavailable: null };

  // 1. Has a passage on the remaining route closed (or stopped matching the constraints)?
  const path = { nodeIds: option.nodeIds, edgeIds: option.edgeIds };
  const missing = option.edgeIds.find((id) => !graph.edgeById.has(id));
  const { edges } = missing ? { edges: [] } : orient(graph, path);
  const progress = trackProgress(edges, position, graph.nodes.get(option.nodeIds[0]!));
  const remainingFrom = Math.max(0, progress.edgeIndex);
  const blocked = missing ? undefined : edges.slice(remainingFrom).find((e) => !edgeAllowed(e.edge, option.constraints));

  // 2. Deviation
  const threshold = Math.max(OFF_ROUTE_MIN_M, 2 * (input.position.accuracyM ?? 0));
  let reason: RecheckReason | null = null;
  if (missing || blocked) reason = 'EDGE_CLOSED';
  else if (progress.edgeIndex === -1 && edges.length > 0) reason = 'WRONG_FLOOR';
  else if (progress.distanceM > threshold) reason = 'OFF_ROUTE';

  const distanceFromRouteM = Number.isFinite(progress.distanceM) ? Math.round(progress.distanceM * 10) / 10 : null;

  if (!reason) {
    const arrived = progress.remainingM <= ARRIVAL_RADIUS_M;
    const steps = buildOption(contextFor(route, graph, lang, route.from), optionId, option.constraints, { ...path, engine: activeEngine.id, prefiltered: [] }).steps;
    const currentEdge = edges[progress.edgeIndex]?.edge.id;
    const nextStep = steps.find((s) => currentEdge !== undefined && s.edgeIds.includes(currentEdge));
    return {
      ...base,
      version: route.version,
      status: arrived ? 'ARRIVED' : 'ON_ROUTE',
      reason: null,
      message: arrived ? t.arrived : t.onRoute,
      distanceFromRouteM,
      progress: {
        completedM: Math.round(progress.completedM * 10) / 10,
        remainingM: Math.round(progress.remainingM * 10) / 10,
        nextStepIndex: arrived ? null : (nextStep?.index ?? null),
      },
    };
  }

  // 3. Reroute from the current position
  const snap = await snapToGraph(position.x, position.y, position.level, position.floorId);
  if (!snap || snap.distanceM > MAX_SNAP_M) throw new HttpError(422, 'LOCATION_OFF_GRAPH', `No walkable path within ${MAX_SNAP_M} m of this position`);
  const startNode = graph.nodes.get(snap.nodeId)!;
  const from: ResolvedLocation = {
    type: 'point',
    nodeId: startNode.id,
    name: startNode.label ?? startNode.landmark ?? route.from.name,
    level: startNode.level,
    floorId: startNode.floorId,
    x: position.x,
    y: position.y,
    snappedDistanceM: Math.round(snap.distanceM * 10) / 10,
  };
  const ctx = contextFor(route, graph, lang, from);
  const blockedEdge = blocked
    ? { edgeId: blocked.edge.id, description: describeEdge(graph, blocked.edge), closedReason: blocked.edge.closedReason }
    : missing
      ? { edgeId: missing, description: missing, closedReason: null }
      : null;

  const newPath = findPath(graph, from.nodeId, route.to.nodeId, option.constraints, edgeCostFor(route.mode));
  route.version += 1;
  if (!newPath) {
    const unavailable = explainNoRoute(ctx, optionId, option.constraints);
    bus.emit('route.invalidated', { routeId, option: optionId, reason, edgeId: blockedEdge?.edgeId ?? null, version: route.version, rerouted: false });
    return { ...base, version: route.version, status: 'NO_ROUTE', reason, message: unavailable.message, distanceFromRouteM, progress: null, blockedEdge, unavailable };
  }

  const dto = buildOption(ctx, optionId, option.constraints, newPath);
  route.options.set(optionId, { ...option, nodeIds: newPath.nodeIds, edgeIds: newPath.edgeIds });
  bus.emit('route.invalidated', { routeId, option: optionId, reason, edgeId: blockedEdge?.edgeId ?? null, version: route.version, rerouted: true });
  return {
    ...base,
    version: route.version,
    status: 'REROUTED',
    reason,
    message: t.rerouted[reason](blockedEdge?.description ?? ''),
    distanceFromRouteM,
    progress: null,
    blockedEdge,
    route: dto,
  };
}

// ───────────── live invalidation ─────────────

/**
 * When a passage changes (closed by an admin, or an approved map correction), every
 * planned route through it that no longer satisfies its constraints is told to recheck.
 */
bus.on('edge.changed', ({ edgeId }) => {
  void (async () => {
    const graph = await getCampusGraph(); // reloaded: the graph cache listens to the same event first
    const edge = graph.edgeById.get(edgeId);
    for (const { route, option } of routesUsingEdge(edgeId)) {
      if (edge && edgeAllowed(edge, option.constraints)) continue;
      bus.emit('route.invalidated', { routeId: route.id, option: option.id, reason: 'EDGE_CLOSED', edgeId, version: route.version, rerouted: false });
    }
  })().catch((err: unknown) => logger.error({ err, edgeId }, 'route invalidation failed'));
});
