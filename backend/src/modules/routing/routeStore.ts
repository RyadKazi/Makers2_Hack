/**
 * Planned routes kept in memory for /recheck and live invalidation.
 * Route ids are random UUIDs (unguessable), routes expire after 3 hours,
 * and a server restart simply makes clients plan again (404 ROUTE_NOT_FOUND).
 * No user id is kept: mobility points may be tagged with a route id, and that tag must
 * not be linkable to an account (privacy by design).
 */
import { randomUUID } from 'node:crypto';
import type { Lang } from '../../lib/i18n.js';
import type { EffectiveConstraints } from './constraints.js';
import type { TravelMode } from './costs.js';
import type { ResolvedLocation } from './locations.js';

export type OptionId = 'fastest' | 'step-free';

export type StoredOption = { id: OptionId; constraints: EffectiveConstraints; nodeIds: string[]; edgeIds: string[] };

export type StoredRoute = {
  id: string;
  version: number;
  lang: Lang;
  mode: TravelMode;
  walkingSpeedMs: number;
  shoreline: boolean;
  from: ResolvedLocation;
  to: ResolvedLocation;
  options: Map<OptionId, StoredOption>;
  createdAt: number;
  expiresAt: number;
};

export const ROUTE_TTL_MS = 3 * 3_600_000;
const MAX_ROUTES = 10_000;
const routes = new Map<string, StoredRoute>();

function sweep(now = Date.now()): void {
  for (const [id, r] of routes) if (r.expiresAt <= now) routes.delete(id);
  while (routes.size > MAX_ROUTES) routes.delete(routes.keys().next().value!);
}

export function saveRoute(route: Omit<StoredRoute, 'id' | 'version' | 'createdAt' | 'expiresAt'>): StoredRoute {
  sweep();
  const now = Date.now();
  const stored: StoredRoute = { ...route, id: randomUUID(), version: 1, createdAt: now, expiresAt: now + ROUTE_TTL_MS };
  routes.set(stored.id, stored);
  return stored;
}

export function getRoute(id: string): StoredRoute | undefined {
  const r = routes.get(id);
  if (r && r.expiresAt <= Date.now()) {
    routes.delete(id);
    return undefined;
  }
  return r;
}

/** Routes whose option uses this edge. */
export function routesUsingEdge(edgeId: string): { route: StoredRoute; option: StoredOption }[] {
  sweep();
  const out: { route: StoredRoute; option: StoredOption }[] = [];
  for (const route of routes.values()) {
    for (const option of route.options.values()) if (option.edgeIds.includes(edgeId)) out.push({ route, option });
  }
  return out;
}

export function clearRoutes(): void {
  routes.clear();
}
