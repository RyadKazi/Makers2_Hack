/**
 * Step 7 pure logic on real API payloads (src/test/fixtures): route track, progress,
 * cues, reroute wording, checkpoints, simulator, georeference, point logger, speech fallback.
 */
import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import type { RouteOption, RoutePlan, RouteRecheck } from '@/api/types';
import { MAX_BATCH, TrackLogger } from '@/features/sharing/sharing';
import i18n from '@/i18n';
import { formatUnit } from '@/lib/format';
import planFastestJson from '@/test/fixtures/planA104Fastest.json';
import planJson from '@/test/fixtures/planA104.json';
import recheckJson from '@/test/fixtures/recheckRerouted.json';
import { campusGeoref, parseCheckpoint, sameCode, Simulator, toCampusXY, type Position } from './position';
import { buildTrack, dueCues, locate, metresToNextStep, positionAt, splitForFloor, stepIndexAt, transitionsOnFloor, vibrationFor, viaOf } from './routeModel';
import { Speaker } from './speech';
import { rerouteMessage } from './useNavigationController';

const plan = planJson as unknown as RoutePlan;
const fastest = plan.options.find((o) => o.id === 'fastest')!;
const stepFree = plan.options.find((o) => o.id === 'step-free')!;
const recheck = recheckJson as unknown as RouteRecheck;
const L0 = plan.from.floorId!;
const L1 = plan.to.floorId!;

describe('route track', () => {
  it('chains the per-floor GeoJSON in walking order, with stair / elevator rides as vertical segments', () => {
    for (const option of [fastest, stepFree]) {
      const track = buildTrack(option, plan.from);
      expect(track.points[0]).toMatchObject({ x: 56, y: 85, level: 0, d: 0 });
      expect(track.points.at(-1)).toMatchObject({ x: plan.to.x, y: plan.to.y, level: 1 });
      // Total = walked metres + vertical metres = the API distance.
      expect(track.total).toBeCloseTo(option.distanceM, 0);
      // No jump: consecutive horizontal points are joined, edges were re-oriented where needed.
      for (let i = 1; i < track.points.length; i++) {
        const [a, b] = [track.points[i - 1]!, track.points[i]!];
        if (!b.vertical) expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(b.d - a.d, 5);
      }
      const starts = option.steps.map((s) => track.stepStart[s.index]!);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    }
    const t = buildTrack(fastest, plan.from);
    expect(fastest.steps.map((s) => Math.round(t.stepStart[s.index]! * 10) / 10)).toEqual([0, 0, 15, 23, 31, 41, 49, 77, 78.5]);
    expect(t.points.filter((p) => p.vertical)).toEqual([expect.objectContaining({ vertical: 'STAIRS', level: 1, x: 64, y: 92 })]);
  });

  it('places the walker on the track, changes level half-way through a ride, and knows the floor', () => {
    const t = buildTrack(fastest, plan.from);
    expect(positionAt(t, 16)).toMatchObject({ x: 57, y: 100, level: 0 });
    expect(positionAt(t, 33).level).toBe(0);
    expect(positionAt(t, 37)).toMatchObject({ level: 1, floorId: L1 });
    expect(locate(t, { x: 60, y: 100, level: 0, floorId: L0 })).toEqual({ d: 19, offRouteM: 0 });
    expect(locate(t, { x: 60, y: 103, level: 0, floorId: L0 })?.offRouteM).toBeCloseTo(3);
    expect(locate(t, { x: 60, y: 100, level: 2, floorId: null })).toBeNull();
  });

  it('tracks the current step and the metres left on it', () => {
    const t = buildTrack(fastest, plan.from);
    expect(stepIndexAt(t, 0)).toBe(1);
    expect(stepIndexAt(t, 16)).toBe(2);
    expect(stepIndexAt(t, 36)).toBe(4);
    expect(stepIndexAt(t, t.total)).toBe(8);
    expect(metresToNextStep(t, 2, 16)).toBe(7);
  });

  it('splits the route per floor into walked / remaining parts, with the elevator to the next floor', () => {
    const t = buildTrack(stepFree, plan.from);
    const { done, todo } = splitForFloor(t, 10, { level: 0, floorId: L0 });
    expect(done).toEqual([[{ x: 56, y: 85 }, { x: 56, y: 95 }]]);
    expect(todo[0]![0]).toEqual({ x: 56, y: 95 });
    expect(splitForFloor(t, 10, { level: 1, floorId: L1 }).done).toEqual([]);
    expect(transitionsOnFloor(t, L0)).toEqual([expect.objectContaining({ kind: 'ELEVATOR', toLevel: 1, x: 54.5, y: 106 })]);
    expect(transitionsOnFloor(t, L1)).toEqual([expect.objectContaining({ kind: 'ELEVATOR', toLevel: 0 })]);
  });
});

describe('cues and wording', () => {
  it('pre-announces the next decision point ~12 m before, then announces it on arrival, once each', () => {
    const t = buildTrack(stepFree, plan.from);
    const said = new Set<string>();
    expect(dueCues(t, 5, said, 1)).toEqual([]);
    const pre = dueCues(t, 10, said, 1);
    expect(pre).toEqual([expect.objectContaining({ kind: 'pre', step: expect.objectContaining({ type: 'ELEVATOR' }) })]);
    pre.forEach((c) => said.add(c.key));
    expect(dueCues(t, 11, said, 1)).toEqual([]);
    expect(dueCues(t, 19, said, 1)).toEqual([expect.objectContaining({ kind: 'at', step: expect.objectContaining({ type: 'ELEVATOR' }) })]);
    // A new route version speaks again.
    expect(dueCues(t, 10, said, 2)).toHaveLength(1);
  });

  it('vibrates differently for left, right and floor changes', () => {
    expect(vibrationFor({ ...fastest.steps[0]!, type: 'WALK', turn: 'LEFT' })).toEqual([400]);
    expect(vibrationFor({ ...fastest.steps[0]!, type: 'WALK', turn: 'RIGHT' })).toEqual([120, 100, 120]);
    expect(vibrationFor({ ...fastest.steps[0]!, type: 'ELEVATOR', turn: null })).toHaveLength(5);
    expect(vibrationFor({ ...fastest.steps[0]!, type: 'WALK', turn: 'STRAIGHT' })).toBeNull();
  });

  it('explains a reroute from the real recheck answer: what closed, and the way through', () => {
    const old = (planFastestJson as unknown as RoutePlan).options[0]!;
    expect(viaOf(recheck.route as RouteOption, old.edgeIds)?.type).toBe('ELEVATOR');
    expect(rerouteMessage(i18n.getFixedT('en'), old, recheck)).toBe('Escalier Bloc A is closed — rerouting via the elevator.');
    expect(rerouteMessage(i18n.getFixedT('fr'), old, recheck)).toBe('Escalier Bloc A est fermé — nouvel itinéraire par l’ascenseur.');
    const elevatorDown = { ...recheck, blockedEdge: { edgeId: 'E-A0-ELEV--A1-ELEV', description: 'Ascenseur Bloc A', closedReason: null } };
    expect(rerouteMessage(i18n.getFixedT('en'), stepFree, elevatorDown)).toMatch(/^Ascenseur Bloc A is out of service — /);
  });

  it('formats metres with a number in Arabic (narrow), like the server instructions', () => {
    expect(formatUnit(1, 'meter', 'ar')).toBe('1 م');
    expect(formatUnit(12, 'meter', 'fr')).toMatch(/^12\sm$/u); // narrow no-break space
  });
});

describe('position providers', () => {
  it('reads QR checkpoint links, typed codes and room codes', () => {
    expect(parseCheckpoint('https://campus.example/navigate?at=poi:abc123')).toEqual({ kind: 'poi', id: 'abc123' });
    expect(parseCheckpoint('room:A-104')).toEqual({ kind: 'room', id: 'A-104' });
    expect(parseCheckpoint(' a104 ')).toEqual({ kind: 'room', id: 'a104' });
    expect(parseCheckpoint('https://campus.example/navigate')).toBeNull();
    expect(parseCheckpoint('hello world')).toBeNull();
    expect(sameCode('a104', 'A-104')).toBe(true);
    expect(sameCode('A-104', 'A-140')).toBe(false);
  });

  it('simulates walking at 1.2 m/s, rides take a fixed time, and a wrong turn leaves the route', () => {
    const t = buildTrack(fastest, plan.from);
    const sim = new Simulator(t, 1.2);
    expect(sim.tick(1, 1)).toMatchObject({ source: 'simulator', accuracyM: 1, level: 0 });
    expect(sim.d).toBeCloseTo(1.2);
    sim.tick(1, 4);
    expect(sim.d).toBeCloseTo(6);
    sim.setTrack(t, 31); // foot of the stairs: 10 m in 8 s
    sim.tick(4, 1);
    expect(sim.d).toBeCloseTo(36);
    const off = sim.wrongTurn();
    expect(locate(t, { ...off, floorId: off.floorId })!.offRouteM).toBeGreaterThan(8);
    sim.setTrack(t, t.total - 0.5);
    sim.tick(5, 1);
    expect(sim.done).toBe(true);
  });

  it('converts satellite fixes to campus metres when a georeference is configured', () => {
    expect(campusGeoref(undefined)).toBeNull();
    const ref = campusGeoref('36.7,3.1,0')!;
    const p = toCampusXY(36.701, 3.101, ref);
    expect(p.y).toBeCloseTo(110.54, 1);
    expect(p.x).toBeCloseTo(111.32 * Math.cos((36.7 * Math.PI) / 180), 1);
    const rotated = toCampusXY(36.701, 3.1, campusGeoref('36.7,3.1,90')!);
    expect(rotated.x).toBeCloseTo(110.54, 1);
  });
});

describe('sharing: point logger', () => {
  const pos = (over: Partial<Position> = {}): Position => ({ x: 10, y: 20, level: 0, floorId: null, accuracyM: 3, source: 'qr', label: null, at: Date.parse('2026-11-20T09:00:00Z'), ...over });

  it('sends real, accurate positions tagged with the route; never simulated ones', async () => {
    const send = vi.fn(async () => undefined);
    const logger = new TrackLogger('s1', send, false);
    logger.add(pos({ source: 'simulator' }), 'r1');
    logger.add(pos({ accuracyM: 12 }), 'r1');
    logger.add(pos(), 'r1');
    logger.add(pos({ x: 10.3, at: pos().at + 1000 }), 'r1'); // < 1 m within 5 s: skipped
    logger.add(pos({ x: 14, floorId: 'f1', level: 1, at: pos().at + 2000 }), null);
    expect(logger.pending).toBe(2);
    await logger.flush();
    expect(send).toHaveBeenCalledWith({
      sessionId: 's1',
      points: [
        { recordedAt: '2026-11-20T09:00:00.000Z', x: 10, y: 20, level: 0, accuracyM: 3, routeId: 'r1' },
        { recordedAt: '2026-11-20T09:00:02.000Z', x: 14, y: 20, level: 1, floorId: 'f1', accuracyM: 3 },
      ],
    });
  });

  it('flushes on its own when a batch is full (≤ 100 points)', () => {
    const send = vi.fn(async () => undefined);
    const logger = new TrackLogger('s1', send, true);
    for (let i = 0; i < MAX_BATCH; i++) logger.add(pos({ x: i * 2, at: pos().at + i * 1000, source: 'simulator' }), 'r1');
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ points: unknown[] }])[0].points).toHaveLength(MAX_BATCH);
  });
});

describe('speech', () => {
  const spoken: string[] = [];
  let ttsCalls = 0;
  beforeEach(() => {
    spoken.length = 0;
    ttsCalls = 0;
    class Utterance {
      lang = '';
      rate = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: (u: Utterance) => (spoken.push(`${u.lang}:${u.text}`), setTimeout(() => u.onend?.(), 0)), cancel: vi.fn(), getVoices: () => [] },
    });
    api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      ttsCalls += 1;
      throw Object.assign(new Error('unavailable'), { isAxiosError: true, config, response: { status: 503, data: { error: { code: 'TTS_UNAVAILABLE' } }, headers: {}, config } });
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the device voice when the server voice is unavailable, then stops asking the server', async () => {
    const speaker = new Speaker({ serverVoice: () => true });
    speaker.speak('Tournez à gauche', 'fr');
    await vi.waitFor(() => expect(spoken).toEqual(['fr-FR:Tournez à gauche']));
    speaker.speak('انعطف يسارًا', 'ar');
    await vi.waitFor(() => expect(spoken).toHaveLength(2));
    expect(spoken[1]).toBe('ar-DZ:انعطف يسارًا');
    expect(ttsCalls).toBe(1);
  });

  it('interrupting drops the queue; muted speaks nothing', async () => {
    const speaker = new Speaker({ serverVoice: () => false });
    speaker.setMuted(true);
    speaker.speak('one', 'en');
    expect(spoken).toEqual([]);
    speaker.setMuted(false);
    speaker.speak('two', 'en');
    speaker.speak('three', 'en', { interrupt: true });
    await vi.waitFor(() => expect(spoken.at(-1)).toBe('en-GB:three'));
  });
});
