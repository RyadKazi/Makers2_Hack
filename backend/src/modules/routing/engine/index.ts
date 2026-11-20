import { standInDijkstra } from './standInDijkstra.js';
import type { RoutingEngine } from './types.js';

/**
 * The routing engine used by the API. Swap this single line to plug in the
 * teammate's algorithm once its adapter exists (see ../core/README.md).
 */
export const activeEngine: RoutingEngine<unknown> = standInDijkstra as RoutingEngine<unknown>;

export type { EngineConstraint, EngineConstraints, EnginePath, RoutingEngine } from './types.js';
