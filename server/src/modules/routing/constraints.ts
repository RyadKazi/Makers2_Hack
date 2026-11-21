/**
 * Constraints layer: user profile + request overrides → effective constraints →
 * (a) options the engine applies natively, (b) edges filtered out beforehand
 * for constraints the engine does not support. One predicate per constraint,
 * also used to explain why no route exists.
 */
import type { RoutingEdge } from './graph.repository.js';
import type { EngineConstraint, EngineConstraints, RoutingEngine } from './engine/types.js';

export const CONSTRAINT_KEYS = ['closedPassages', 'avoidStairs', 'maxSlopePercent', 'minDoorWidthCm', 'verifiedRampsOnly', 'verifiedOnly', 'avoidEdgeIds'] as const;
export type ConstraintKey = (typeof CONSTRAINT_KEYS)[number];

export type EffectiveConstraints = {
  /** Always true for real routes; relaxed only to diagnose "no route". */
  closedPassages: boolean;
  avoidStairs: boolean;
  maxSlopePercent: number | null;
  minDoorWidthCm: number | null;
  verifiedRampsOnly: boolean;
  verifiedOnly: boolean;
  avoidEdgeIds: string[];
};

export type ConstraintsInput = {
  avoidStairs?: boolean | undefined;
  maxSlopePercent?: number | null | undefined;
  minDoorWidthCm?: number | null | undefined;
  verifiedRampsOnly?: boolean | undefined;
  verifiedOnly?: boolean | undefined;
  avoidEdgeIds?: string[] | undefined;
};

export type ProfileConstraints = {
  stepFree: boolean;
  requireVerifiedRamps: boolean;
  maxSlopePercent: number | null;
  minPassageWidthCm: number | null;
};

export const NO_CONSTRAINTS: EffectiveConstraints = {
  closedPassages: true,
  avoidStairs: false,
  maxSlopePercent: null,
  minDoorWidthCm: null,
  verifiedRampsOnly: false,
  verifiedOnly: false,
  avoidEdgeIds: [],
};

/** Profile first, then explicit request values win (they may tighten or relax the profile). */
export function mergeConstraints(profile: ProfileConstraints | null, input: ConstraintsInput = {}): EffectiveConstraints {
  const base: EffectiveConstraints = profile
    ? {
        ...NO_CONSTRAINTS,
        avoidStairs: profile.stepFree,
        verifiedRampsOnly: profile.requireVerifiedRamps,
        maxSlopePercent: profile.maxSlopePercent,
        minDoorWidthCm: profile.minPassageWidthCm,
      }
    : { ...NO_CONSTRAINTS };
  return {
    ...base,
    ...(input.avoidStairs !== undefined ? { avoidStairs: input.avoidStairs } : {}),
    ...(input.maxSlopePercent !== undefined ? { maxSlopePercent: input.maxSlopePercent } : {}),
    ...(input.minDoorWidthCm !== undefined ? { minDoorWidthCm: input.minDoorWidthCm } : {}),
    ...(input.verifiedRampsOnly !== undefined ? { verifiedRampsOnly: input.verifiedRampsOnly } : {}),
    ...(input.verifiedOnly !== undefined ? { verifiedOnly: input.verifiedOnly } : {}),
    ...(input.avoidEdgeIds !== undefined ? { avoidEdgeIds: [...new Set(input.avoidEdgeIds)] } : {}),
  };
}

export type Violation = { constraint: ConstraintKey; value: number | string | null; limit: number | string | null };

/** Every constraint this edge breaks (empty = allowed). */
export function violations(edge: RoutingEdge, c: EffectiveConstraints): Violation[] {
  const out: Violation[] = [];
  if (c.closedPassages && !edge.isOpen) out.push({ constraint: 'closedPassages', value: edge.closedReason, limit: null });
  if (c.avoidStairs && edge.hasStairs) out.push({ constraint: 'avoidStairs', value: edge.stepCount, limit: 0 });
  if (c.maxSlopePercent !== null && edge.slopePercent > c.maxSlopePercent) {
    out.push({ constraint: 'maxSlopePercent', value: edge.slopePercent, limit: c.maxSlopePercent });
  }
  if (c.minDoorWidthCm !== null) {
    const narrowest = Math.min(edge.widthCm, edge.doorClearanceCm ?? Infinity);
    if (narrowest < c.minDoorWidthCm) out.push({ constraint: 'minDoorWidthCm', value: narrowest, limit: c.minDoorWidthCm });
  }
  if (c.verifiedRampsOnly && edge.isRamp && !edge.verified) out.push({ constraint: 'verifiedRampsOnly', value: 'unverified ramp', limit: null });
  if (c.verifiedOnly && !edge.verified) out.push({ constraint: 'verifiedOnly', value: 'unverified', limit: null });
  if (c.avoidEdgeIds.includes(edge.id)) out.push({ constraint: 'avoidEdgeIds', value: edge.id, limit: null });
  return out;
}

export function edgeAllowed(edge: RoutingEdge, c: EffectiveConstraints): boolean {
  return violations(edge, c).length === 0;
}

/** Constraints that actually restrict something. */
export function activeConstraints(c: EffectiveConstraints): ConstraintKey[] {
  return CONSTRAINT_KEYS.filter((k) => {
    const v = c[k];
    return Array.isArray(v) ? v.length > 0 : v !== false && v !== null;
  });
}

export function relax(c: EffectiveConstraints, keys: readonly ConstraintKey[]): EffectiveConstraints {
  const out = { ...c };
  for (const k of keys) {
    if (k === 'avoidEdgeIds') out.avoidEdgeIds = [];
    else if (k === 'maxSlopePercent' || k === 'minDoorWidthCm') out[k] = null;
    else out[k] = false;
  }
  return out;
}

const ENGINE_NAME: Record<ConstraintKey, EngineConstraint> = {
  closedPassages: 'excludeClosed',
  avoidStairs: 'avoidStairs',
  maxSlopePercent: 'maxSlopePercent',
  minDoorWidthCm: 'minWidthCm',
  verifiedRampsOnly: 'verifiedRampsOnly',
  verifiedOnly: 'verifiedOnly',
  avoidEdgeIds: 'avoidEdges',
};

export type EngineCall = {
  /** Edges left after pre-filtering the constraints the engine cannot apply. */
  edges: RoutingEdge[];
  constraints: EngineConstraints;
  /** Constraints handled by filtering, for logs and the response. */
  prefiltered: ConstraintKey[];
  /** Stable key of the filter, for caching built graphs. */
  filterKey: string;
};

/** Splits the effective constraints between the engine (native) and a pre-filter. */
export function prepareEngineCall(engine: RoutingEngine<unknown>, edges: readonly RoutingEdge[], c: EffectiveConstraints): EngineCall {
  const native = engine.capabilities.constraints;
  const active = activeConstraints(c);
  const prefiltered = active.filter((k) => !native.has(ENGINE_NAME[k]));

  const constraints: EngineConstraints = { excludeClosed: c.closedPassages };
  for (const k of active) {
    if (prefiltered.includes(k)) continue;
    if (k === 'avoidStairs') constraints.avoidStairs = true;
    if (k === 'maxSlopePercent') constraints.maxSlopePercent = c.maxSlopePercent!;
    if (k === 'minDoorWidthCm') constraints.minWidthCm = c.minDoorWidthCm!;
    if (k === 'verifiedRampsOnly') constraints.verifiedRampsOnly = true;
    if (k === 'verifiedOnly') constraints.verifiedOnly = true;
    if (k === 'avoidEdgeIds') constraints.avoidEdges = new Set(c.avoidEdgeIds);
  }
  // An engine that cannot exclude closed edges gets them filtered out.
  if (!native.has('excludeClosed') && c.closedPassages && !prefiltered.includes('closedPassages')) prefiltered.push('closedPassages');

  const filter = relax(NO_CONSTRAINTS, CONSTRAINT_KEYS);
  for (const k of prefiltered) (filter as Record<string, unknown>)[k] = c[k];
  const filtered = prefiltered.length ? edges.filter((e) => edgeAllowed(e, filter)) : [...edges];

  return { edges: filtered, constraints, prefiltered, filterKey: JSON.stringify(prefiltered.map((k) => [k, c[k]])) };
}
