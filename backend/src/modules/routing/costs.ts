/**
 * Cost hook: what the engine minimises (when it accepts custom edge costs).
 * Distances reported to users are always real metres; costs only rank routes.
 */
import { ELEVATOR_PENALTY_M } from './graph.js';
import type { RoutingEdge } from './graph.repository.js';

export type TravelMode = 'walking' | 'wheelchair';

/** Extra metres for an unverified ramp: usable, but prefer a known-good one. */
export const UNVERIFIED_RAMP_PENALTY_M = 25;

const SURFACE_FACTOR: Record<TravelMode, Record<string, number>> = {
  walking: { GRAVEL: 1.1 },
  wheelchair: { GRAVEL: 1.6, PAVERS: 1.1 },
};

/** Crowd penalty in metres per edge, fed by HeatmapCell hotspots (step 4). 0 for now. */
export type CrowdPenaltyProvider = (edge: RoutingEdge) => number;
let crowdPenalty: CrowdPenaltyProvider = () => 0;

export function setCrowdPenaltyProvider(provider: CrowdPenaltyProvider): void {
  crowdPenalty = provider;
}

export function edgeCostFor(mode: TravelMode): (edge: RoutingEdge) => number {
  const surfaces = SURFACE_FACTOR[mode];
  return (edge) =>
    edge.lengthM * (surfaces[edge.surface] ?? 1) +
    (edge.isElevator ? ELEVATOR_PENALTY_M : 0) +
    (edge.isRamp && !edge.verified ? UNVERIFIED_RAMP_PENALTY_M : 0) +
    Math.max(0, crowdPenalty(edge));
}
