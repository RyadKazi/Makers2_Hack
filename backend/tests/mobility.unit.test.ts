import { describe, expect, it } from 'vitest';
import { KEY_EDGES } from '../prisma/seed/campus.js';
import { detectDwells, detectUTurns, repeatedUTurns, type TrackPoint } from '../src/modules/mobility/detectors.js';
import { sideOfSegment } from '../src/modules/mobility/hotspots.js';
import { MAX_ACCURACY_M, redactNote, SESSION_MAX_MS } from '../src/modules/mobility/privacy.js';
import { computePseudoId } from '../src/modules/mobility/pseudonym.js';
import { detourAround, kindFor, scoreOf } from '../src/modules/mobility/recommendations.js';
import { autoStopOf } from '../src/modules/mobility/sessions.service.js';
import { smoothingFactor, smoothTrack, type RawPoint } from '../src/modules/mobility/smoothing.js';
import { seedGraph } from './helpers/graph.js';

const t0 = new Date('2026-11-20T09:00:00Z').getTime();
const at = (s: number) => new Date(t0 + s * 1000);

describe('pseudonymisation', () => {
  const salt = 'a'.repeat(64);
  it('is deterministic for a user, a day and a salt', () => {
    expect(computePseudoId('user-1', '2026-11-20', salt)).toBe(computePseudoId('user-1', '2026-11-20', salt));
  });
  it('rotates every day and with every salt, and differs between users', () => {
    const base = computePseudoId('user-1', '2026-11-20', salt);
    expect(computePseudoId('user-1', '2026-11-21', salt)).not.toBe(base);
    expect(computePseudoId('user-1', '2026-11-20', 'b'.repeat(64))).not.toBe(base);
    expect(computePseudoId('user-2', '2026-11-20', salt)).not.toBe(base);
  });
  it('depends on the server secret and never contains the user id', () => {
    const id = computePseudoId('cmuser123456', '2026-11-20', salt);
    expect(id).toHaveLength(32);
    expect(id).not.toContain('cmuser');
    expect(computePseudoId('cmuser123456', '2026-11-20', salt, 'another-secret-another-secret-xx')).not.toBe(id);
  });
});

describe('notes', () => {
  it('redacts contact details and limits length', () => {
    expect(redactNote('Appelez-moi au 0555 12 34 56 ou karim@univ.dz svp')).toBe('Appelez-moi au […] ou […] svp');
    expect(redactNote('x'.repeat(400))).toHaveLength(280);
  });
});

describe('auto-stop', () => {
  it('stops 3 hours after the start', () => {
    const start = new Date('2026-11-20T08:00:00Z'); // 09:00 in Algiers
    expect(autoStopOf({ startedAt: start, dayKey: '2026-11-20' })).toEqual({ at: new Date(start.getTime() + SESSION_MAX_MS), reason: 'TIME_LIMIT' });
  });
  it('stops at midnight (Africa/Algiers) when that comes first', () => {
    const start = new Date('2026-11-20T21:30:00Z'); // 22:30 in Algiers
    expect(autoStopOf({ startedAt: start, dayKey: '2026-11-20' })).toEqual({ at: new Date('2026-11-20T23:00:00Z'), reason: 'DAILY_RESET' });
  });
});

describe('smoothing', () => {
  const p = (s: number, x: number, y: number, accuracyM = 3, level = 0): RawPoint => ({ recordedAt: at(s), x, y, level, accuracyM });

  it('trusts accurate fixes and damps inaccurate ones', () => {
    expect(smoothingFactor(3)).toBe(1);
    expect(smoothingFactor(MAX_ACCURACY_M)).toBe(0.35);
  });

  it('drops positioning jumps faster than 3 m/s and smooths the rest', () => {
    const { kept, droppedJitter } = smoothTrack([p(0, 0, 0), p(2, 2, 0), p(4, 40, 0), p(6, 4, 0, 10)]);
    expect(droppedJitter).toBe(1); // 38 m in 2 s
    expect(kept.map((k) => k.x)).toEqual([0, 2, 2.7]); // last one: 2 + 0.35 × (4 − 2)
  });

  it('restarts after a level change or a long gap, and continues from the stored anchor', () => {
    expect(smoothTrack([p(0, 0, 0), p(2, 1, 0, 3, 1)]).kept[1]!.x).toBe(1);
    expect(smoothTrack([p(100, 50, 0)], { recordedAt: at(0), x: 0, y: 0, level: 0 }).kept).toHaveLength(1);
    expect(smoothTrack([p(1, 50, 0)], { recordedAt: at(0), x: 0, y: 0, level: 0 }).droppedJitter).toBe(1);
  });
});

describe('detectors', () => {
  const walk = (from: [number, number], to: [number, number], startS: number, seconds: number): TrackPoint[] =>
    Array.from({ length: seconds / 2 + 1 }, (_, i) => {
      const f = (i * 2) / seconds;
      return { recordedAt: at(startS + i * 2), x: from[0] + (to[0] - from[0]) * f, y: from[1] + (to[1] - from[1]) * f, level: 0 };
    });
  const stay = (x: number, y: number, startS: number, seconds: number): TrackPoint[] =>
    Array.from({ length: seconds / 2 + 1 }, (_, i) => ({ recordedAt: at(startS + i * 2), x: x + ((i % 3) - 1) * 0.8, y: y + ((i % 2) - 0.5), level: 0 }));

  it('finds a dwell longer than 90 s within 3 m, not a short pause', () => {
    const track = [...walk([0, 0], [20, 0], 0, 20), ...stay(20, 0, 22, 120), ...walk([20, 0], [40, 0], 144, 20)];
    const dwells = detectDwells(track);
    expect(dwells).toHaveLength(1);
    expect(dwells[0]!.durationS).toBeGreaterThanOrEqual(120);
    expect(dwells[0]!.x).toBeCloseTo(20, 0);
    expect(detectDwells([...walk([0, 0], [20, 0], 0, 20), ...stay(20, 0, 22, 60)])).toEqual([]);
  });

  it('finds U-turns and groups repeated ones', () => {
    const track = [
      ...walk([0, 0], [20, 0], 0, 16),
      ...walk([20, 0], [5, 0], 18, 12),
      ...walk([5, 0], [20, 0], 32, 12),
      ...walk([20, 0], [20, 30], 46, 24),
    ];
    const turns = detectUTurns(track);
    expect(turns.length).toBeGreaterThanOrEqual(2);
    expect(repeatedUTurns(turns)).toHaveLength(1);
    expect(detectUTurns(walk([0, 0], [50, 0], 0, 40))).toEqual([]);
  });
});

describe('shoreline geometry', () => {
  it('tells which side of the walking direction a wall is on', () => {
    expect(sideOfSegment(0, 0, 10, 0, 5, 2)).toEqual({ side: 'LEFT', distanceM: 2 }); // walking east, wall to the north
    expect(sideOfSegment(10, 0, 0, 0, 5, 2).side).toBe('RIGHT'); // walking west
  });
});

describe('recommendation engine', () => {
  const g = seedGraph();
  const edge = (id: string) => g.edgeById.get(id)!;

  it('computes the step-free detour around the Bloc B entrance steps through the routing engine', () => {
    const { detourM, noAlternative } = detourAround(g, edge(KEY_EDGES.bMainEntranceSteps));
    expect(noAlternative).toBe(false);
    expect(detourM).toBeGreaterThan(120);
    expect(detourM).toBeLessThan(160);
  });

  it('chooses the intervention from the obstacle and the kind of difficulty', () => {
    expect(kindFor(g, edge(KEY_EDGES.bMainEntranceSteps), 'BLOCKED', false)).toBe('RAMP');
    expect(kindFor(g, edge(KEY_EDGES.bMainEntranceSteps), 'BLOCKED', true)).toBe('ACCESSIBLE_ENTRANCE');
    expect(kindFor(g, edge(KEY_EDGES.bStairs01), 'STUCK', false, 'WHEELCHAIR')).toBe('ELEVATOR');
    expect(kindFor(g, edge(KEY_EDGES.bStairs01), 'HARD_TO_NAVIGATE', false)).toBe('SIGNAGE');
    expect(kindFor(g, edge(KEY_EDGES.bStairs01), 'STUCK', false, 'BLIND_LOW_VISION')).toBe('SIGNAGE');
    expect(kindFor(g, edge(KEY_EDGES.libraryRamp), 'TOO_STEEP', false)).toBe('RAMP');
    expect(kindFor(g, edge('E-A1-C24--A1-D-A-102'), 'BLOCKED', false)).toBe('WIDEN_DOOR');
  });

  it('scores 0–100, growing with impact', () => {
    expect(scoreOf(0)).toBe(0);
    expect(scoreOf(500)).toBeLessThan(scoreOf(5000));
    expect(scoreOf(1e9)).toBe(100);
  });
});
