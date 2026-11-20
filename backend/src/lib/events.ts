import { EventEmitter } from 'node:events';

/**
 * In-process domain events. Services publish; the Socket.io layer and caches
 * subscribe. Keeps HTTP handlers free of socket plumbing and easy to test.
 */
export type DomainEvents = {
  /** Reservations of these rooms changed (created, updated, deleted, or started/ended). */
  'rooms.changed': { roomIds: string[] };
  /** A navigation edge was opened or closed. */
  'edge.changed': { edgeId: string };
  /** The navigation graph changed in bulk (e.g. an approved map correction, step 8). */
  'graph.changed': { reason: string };
  /** Mobility sessions (counts only, nothing identifying) — feed /admin live stats. */
  'mobility.sessionStarted': Record<string, never>;
  'mobility.sessionEnded': { reason: string };
  /** The 5-minute aggregation finished. */
  'mobility.aggregated': { computedAt: string; heatmapCells: Record<string, number>; hotspots: number; newCorrections: number; recommendations: number };
  /** Map-correction queue / recommendations changed. */
  'admin.correction': { id: string; status: string; created: boolean };
  'admin.recommendation': { id: string; status: string };
  /** A planned route is no longer valid (closed edge, deviation, reroute). */
  'route.invalidated': {
    routeId: string;
    option: string;
    reason: 'EDGE_CLOSED' | 'OFF_ROUTE' | 'WRONG_FLOOR';
    edgeId: string | null;
    version: number;
    rerouted: boolean;
  };
};

class TypedBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}

export const bus = new TypedBus();
