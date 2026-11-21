import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { io as connect } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KEY_EDGES } from '../prisma/seed/campus.js';
import { bus } from '../src/lib/events.js';
import { algiersDayKey } from '../src/lib/time.js';
import { runDetectors } from '../src/modules/mobility/analysis.js';
import { recomputeHeatmap } from '../src/modules/mobility/heatmap.js';
import { runMobilityAggregation } from '../src/modules/mobility/pipeline.js';
import { POLICY_VERSION } from '../src/modules/mobility/privacy.js';
import { computePseudoId, forgetSalt } from '../src/modules/mobility/pseudonym.js';
import { purgeExpiredRawData } from '../src/modules/mobility/retention.js';
import { autoStopDueSessions, currentStatus, startSession } from '../src/modules/mobility/sessions.service.js';
import { createSocketServer } from '../src/sockets/index.js';
import { prisma, seedTestDatabase, testApp, tokenFor } from './helpers/fixtures.js';

let app: Express;
let tokens: Record<string, string>;
let userIds: Map<string, string>;
const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

beforeAll(async () => {
  ({ userIds } = await seedTestDatabase());
  forgetSalt();
  app = testApp();
  const keys = ['admin', 'haddad', 'yacine', 'amina', 'karim', 'lina'];
  tokens = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await tokenFor(app, k)] as const)));
});
afterAll(() => prisma.$disconnect());

const consent = (key: string) => request(app).post('/api/mobility/consent').set(auth(key)).send({ policyVersion: POLICY_VERSION });
const start = (key: string, body: object = {}) => request(app).post('/api/mobility/sessions').set(auth(key)).send(body);
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
/** A short walk across the central courtyard (inside the geofence). */
const walk = (n: number, from = { x: 110, y: 41 }, stepS = 2) =>
  Array.from({ length: n }, (_, i) => ({ recordedAt: iso((n - i) * stepS * 1000), x: from.x, y: from.y + i * 1.5, level: 0, accuracyM: 4 }));

describe('consent', () => {
  it('rejects sharing without consent', async () => {
    const res = await start('karim');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('shows the policy in the user language and refuses an outdated version', async () => {
    const res = await request(app).get('/api/mobility/consent?lang=ar').set(auth('karim'));
    expect(res.body).toMatchObject({ granted: false, upToDate: false, currentPolicy: { version: POLICY_VERSION, retentionDays: 30 } });
    expect(res.body.currentPolicy.summary[0]).toBe('المشاركة اختيارية ويمكنك إيقافها في أي وقت.');
    const old = await request(app).post('/api/mobility/consent').set(auth('karim')).send({ policyVersion: '2020-01' });
    expect(old.status).toBe(409);
    expect((await consent('karim')).body).toMatchObject({ granted: true, upToDate: true, policyVersion: POLICY_VERSION });
  });
});

describe('sessions and pseudonymisation', () => {
  beforeAll(async () => {
    await consent('yacine');
  });

  it('stores a daily pseudonym and a coarse category — never the user id', async () => {
    const res = await start('yacine');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ state: 'ACTIVE', session: { needsCategory: 'WHEELCHAIR', autoStopReason: expect.any(String) } });

    const row = await prisma.trackingSession.findUniqueOrThrow({ where: { id: res.body.session.id } });
    const userId = userIds.get('yacine')!;
    const salt = (await prisma.pseudonymSalt.findUniqueOrThrow({ where: { dayKey: row.dayKey } })).salt;
    expect(row.pseudoId).toBe(computePseudoId(userId, row.dayKey, salt));
    expect(JSON.stringify(row)).not.toContain(userId);
    expect(Object.keys(row)).not.toContain('userId');
  });

  it('uses a different pseudonym the next day', async () => {
    const userId = userIds.get('yacine')!;
    const today = await startSession(userId, 'WHEELCHAIR', new Date(), 'en');
    const tomorrow = await startSession(userId, 'WHEELCHAIR', new Date(Date.now() + 86_400_000), 'en');
    const [a, b] = await Promise.all([
      prisma.trackingSession.findUniqueOrThrow({ where: { id: today.session!.id } }),
      prisma.trackingSession.findUniqueOrThrow({ where: { id: tomorrow.session!.id } }),
    ]);
    expect(a.dayKey).not.toBe(b.dayKey);
    expect(a.pseudoId).not.toBe(b.pseudoId);
    await prisma.trackingSession.delete({ where: { id: b.id } });
  });

  it('keeps one active session: starting again ends the previous one', async () => {
    const first = await start('yacine');
    const second = await start('yacine');
    const old = await prisma.trackingSession.findUniqueOrThrow({ where: { id: first.body.session.id } });
    expect(old.endReason).toBe('USER');
    expect(second.body.state).toBe('ACTIVE');
  });

  it('stop and status', async () => {
    const s = await start('yacine');
    const stop = await request(app).post(`/api/mobility/sessions/${s.body.session.id}/stop?lang=en`).set(auth('yacine'));
    expect(stop.body).toMatchObject({ state: 'ENDED', message: 'Sharing stopped.', session: { endReason: 'USER' } });
    const status = await request(app).get('/api/mobility/sessions/current').set(auth('yacine'));
    expect(status.body.state).toBe('ENDED');
  });

  it("another user cannot use someone else's session", async () => {
    const s = await start('yacine');
    await consent('lina');
    const res = await request(app).post('/api/mobility/points').set(auth('lina')).send({ sessionId: s.body.session.id, points: walk(3) });
    expect(res.status).toBe(404);
  });
});

describe('auto-stop', () => {
  it('ends a session after 3 hours (TIME_LIMIT), at the 3-hour mark', async () => {
    const userId = userIds.get('yacine')!;
    const started = new Date(Date.now() - 4 * 3_600_000);
    if (algiersDayKey(started) !== algiersDayKey(new Date())) return; // crosses midnight: covered by DAILY_RESET
    const s = await startSession(userId, 'WHEELCHAIR', started, 'en');
    const status = await currentStatus(userId, new Date(), 'en');
    expect(status).toMatchObject({ state: 'ENDED', session: { id: s.session!.id, endReason: 'TIME_LIMIT' } });
    expect(new Date(status.session!.endedAt!).getTime()).toBe(started.getTime() + 3 * 3_600_000);
  });

  it('ends yesterday’s sessions at midnight (DAILY_RESET) in the background job', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const row = await prisma.trackingSession.create({ data: { pseudoId: 'p-old', dayKey: algiersDayKey(yesterday), mobility: 'NONE', startedAt: new Date(yesterday.getTime() - 60_000) } });
    await autoStopDueSessions(new Date());
    const ended = await prisma.trackingSession.findUniqueOrThrow({ where: { id: row.id } });
    expect(ended.endReason).toMatch(/DAILY_RESET|TIME_LIMIT/);
    expect(ended.endedAt).not.toBeNull();
  });

  it('reminds the user during the last 15 minutes', async () => {
    // A user with no other session today: the status shows today's most recently started session.
    const userId = userIds.get('karim')!;
    const started = new Date(Date.now() - (3 * 60 - 10) * 60_000);
    if (algiersDayKey(started) !== algiersDayKey(new Date())) return;
    await startSession(userId, 'WHEELCHAIR', started, 'en');
    const status = await currentStatus(userId, new Date(), 'en');
    expect(status.state).toBe('ACTIVE');
    expect(status.session!.reminder).toMatch(/^Location sharing will stop automatically at \d\d:\d\d/);
  });
});

describe('ingestion', () => {
  let sessionId: string;
  beforeEach(async () => {
    sessionId = (await start('yacine')).body.session.id;
  });
  const send = (points: object[]) => request(app).post('/api/mobility/points').set(auth('yacine')).send({ sessionId, points });

  it('stores accurate points inside the campus and drops inaccurate ones and jumps', async () => {
    const pts = walk(6);
    pts[2]!.accuracyM = 25;
    pts[4] = { ...pts[4]!, x: 160 }; // 50 m sideways in 2 s
    const res = await send(pts);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accepted: 4, dropped: { lowAccuracy: 1, jitter: 1, outsideGeofence: 0 }, session: { state: 'ACTIVE' } });
    expect(await prisma.trackPoint.count({ where: { sessionId } })).toBe(4);
  });

  it('caps batches at 100 points', async () => {
    expect((await send(walk(101, { x: 110, y: 0 }, 0.5))).status).toBe(400);
  });

  it('leaving the geofence ends the session (GEOFENCE_EXIT) and drops the outside points', async () => {
    const pts = walk(4);
    const outside = [
      { recordedAt: iso(1500), x: 230, y: 60, level: 0, accuracyM: 4 },
      { recordedAt: iso(500), x: 110, y: 50, level: 0, accuracyM: 4 },
    ];
    const res = await send([...pts, ...outside]);
    expect(res.body).toMatchObject({ accepted: 4, dropped: { outsideGeofence: 2 }, session: { state: 'ENDED', session: { endReason: 'GEOFENCE_EXIT' } } });
    expect(await prisma.trackPoint.count({ where: { sessionId, x: { gt: 220 } } })).toBe(0);
    const again = await send(walk(2));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'SESSION_ENDED', details: { endReason: 'GEOFENCE_EXIT' } });
  });

  it('records a difficulty report on the nearest passage, inside the campus only', async () => {
    const res = await request(app)
      .post('/api/mobility/events')
      .set(auth('yacine'))
      .send({ sessionId, type: 'BLOCKED', x: 156, y: 82.5, level: 0, note: 'Trois marches. Mon numéro : 0555 11 22 33' });
    expect(res.status).toBe(201);
    expect(res.body.edgeId).toBe(KEY_EDGES.bMainEntranceSteps);
    expect((await prisma.difficultyEvent.findUniqueOrThrow({ where: { id: res.body.id } })).note).toBe('Trois marches. Mon numéro : […]');
    const outside = await request(app).post('/api/mobility/events').set(auth('yacine')).send({ sessionId, type: 'BLOCKED', x: 500, y: 82, level: 0 });
    expect(outside.status).toBe(422);
    const stuck = await request(app).post('/api/mobility/events').set(auth('yacine')).send({ sessionId, type: 'STUCK', x: 156, y: 82, level: 0 });
    expect(stuck.status).toBe(400); // detected automatically, not reported
  });

  it('tags points and reports with the route being followed (route ids carry no account)', async () => {
    const plan = await request(app)
      .post('/api/routes/plan')
      .set(auth('yacine'))
      .send({ from: { type: 'point', x: 110, y: 41, level: 0 }, to: { type: 'room', id: 'A-104' } });
    const routeId: string = plan.body.routeId;
    expect(routeId).toMatch(/^[0-9a-f-]{36}$/);
    const pts = walk(3).map((p, i) => (i < 2 ? { ...p, routeId } : p));
    expect((await send(pts)).body.accepted).toBe(3);
    const rows = await prisma.trackPoint.findMany({ where: { sessionId }, orderBy: { recordedAt: 'asc' }, select: { routeId: true } });
    expect(rows.map((r) => r.routeId)).toEqual([routeId, routeId, null]);

    const report = await request(app).post('/api/mobility/events').set(auth('yacine')).send({ sessionId, type: 'TOO_STEEP', x: 110, y: 44, level: 0, routeId });
    expect(report.status).toBe(201);
    expect((await prisma.difficultyEvent.findUniqueOrThrow({ where: { id: report.body.id } })).routeId).toBe(routeId);
    expect((await send([{ ...walk(1)[0]!, recordedAt: new Date().toISOString(), routeId: 'not-a-uuid' }])).status).toBe(400);
  });
});

describe('withdrawing consent', () => {
  it('ends the session, offers deletion, and deletes on request', async () => {
    await consent('amina');
    const s = await start('amina');
    await request(app).post('/api/mobility/points').set(auth('amina')).send({ sessionId: s.body.session.id, points: walk(5) });

    const revoked = await request(app).delete('/api/mobility/consent').set(auth('amina'));
    expect(revoked.body).toMatchObject({ endedSession: true, deleted: null, deletionOffer: { available: true, endpoint: 'DELETE /api/mobility/data' }, consent: { granted: false } });
    expect((await prisma.trackingSession.findUniqueOrThrow({ where: { id: s.body.session.id } })).endReason).toBe('CONSENT_WITHDRAWN');
    expect((await start('amina')).status).toBe(403);

    const deleted = await request(app).delete('/api/mobility/data').set(auth('amina'));
    expect(deleted.body.deleted).toMatchObject({ sessions: 1, points: 5 });
    expect(await prisma.trackingSession.count({ where: { id: s.body.session.id } })).toBe(0);
  });
});

// ───────── synthetic crowd for aggregation tests ─────────

async function crowdSession(pseudoId: string, mobility: 'WHEELCHAIR' | 'NONE', points: { x: number; y: number }[], events: { type: 'BLOCKED' | 'STUCK'; x: number; y: number; edgeId?: string }[] = []) {
  const startedAt = new Date(Date.now() - 30 * 60_000);
  const s = await prisma.trackingSession.create({
    data: { pseudoId, dayKey: algiersDayKey(new Date()), mobility, startedAt, endedAt: new Date(), endReason: 'USER', pointCount: points.length, lastPointAt: new Date(), analyzedUntil: new Date() },
  });
  await prisma.trackPoint.createMany({ data: points.map((p, i) => ({ sessionId: s.id, recordedAt: new Date(startedAt.getTime() + i * 2000), level: 0, accuracyM: 3, ...p })) });
  await prisma.difficultyEvent.createMany({ data: events.map((e) => ({ sessionId: s.id, type: e.type, mobility, level: 0, recordedAt: new Date(), edgeId: e.edgeId ?? null, x: e.x, y: e.y })) });
  return s;
}

describe('k-anonymity', () => {
  it('never stores or returns a heatmap cell seen by fewer than 5 people', async () => {
    // A quiet corner (5 m, 145 m): 4 people pass there, 5 people pass at (15 m, 145 m).
    for (let i = 0; i < 4; i += 1) await crowdSession(`k-few-${i}`, 'NONE', [{ x: 5.5, y: 145.5 }]);
    for (let i = 0; i < 5; i += 1) await crowdSession(`k-ok-${i}`, 'NONE', [{ x: 15.5, y: 145.5 }]);
    await recomputeHeatmap(prisma, 'TODAY', new Date());

    const cells = await prisma.heatmapCell.findMany({ where: { period: 'TODAY', segment: 'ALL', cellY: 72 } });
    expect(cells.map((c) => [c.cellX, c.contributorCount])).toEqual([[7, 5]]);
    expect(await prisma.heatmapCell.count({ where: { contributorCount: { lt: 5 } } })).toBe(0);

    const api = await request(app).get('/api/admin/heatmap?period=TODAY&category=ALL').set(auth('admin'));
    expect(api.body.kMin).toBe(5);
    expect(api.body.cells.some((c: { cellX: number; cellY: number }) => c.cellX === 2 && c.cellY === 72)).toBe(false);
    expect(api.body.cells.every((c: { contributors: number }) => c.contributors >= 5)).toBe(true);
  });

  it('is enforced by the database too', async () => {
    await expect(
      prisma.heatmapCell.create({
        data: { period: 'TODAY', level: 0, cellSizeM: 2, cellX: 99, cellY: 99, segment: 'ALL', windowStart: new Date(), windowEnd: new Date(), visitCount: 4, contributorCount: 4, x: 0, y: 0 },
      }),
    ).rejects.toThrow(/heatmap_cells_k_anonymity|23514|check/i);
  });
});

describe('aggregation pipeline, admin API and live updates', () => {
  let http: HttpServer;
  let sockets: ReturnType<typeof createSocketServer>;
  let url: string;

  beforeAll(async () => {
    // 7 wheelchair users blocked at the Bloc B entrance steps.
    const approach = Array.from({ length: 30 }, (_, i) => ({ x: 120 + i * 1.2, y: 78 + (i % 2) * 0.5 }));
    for (let i = 0; i < 7; i += 1) {
      await crowdSession(`b-entrance-${i}`, 'WHEELCHAIR', approach, [
        { type: 'BLOCKED', x: 156 + (i % 3) * 0.4, y: 81, edgeId: KEY_EDGES.bMainEntranceSteps },
        { type: 'STUCK', x: 155.5, y: 80.5, edgeId: KEY_EDGES.bMainEntranceSteps },
      ]);
    }
    http = createServer(app);
    sockets = createSocketServer(http);
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/admin`;
  });
  afterAll(async () => {
    await sockets.close();
    http.close();
  });

  it('only admins can read mobility aggregates', async () => {
    for (const path of ['heatmap', 'hotspots', 'corrections', 'recommendations', 'stats']) {
      expect((await request(app).get(`/api/admin/${path}`).set(auth('haddad'))).status).toBe(403);
    }
  });

  it('builds a hotspot with a correction proposal and a scored, explained recommendation; pushes it to /admin', async () => {
    const socket = connect(url, { auth: { token: tokens.admin }, transports: ['websocket'], forceNew: true });
    const firstStats = new Promise<{ kMin: number }>((r) => socket.once('stats', r));
    expect((await firstStats).kMin).toBe(5);
    const aggregated = new Promise<{ hotspots: number }>((r) => socket.once('mobility:aggregated', r));

    const summary = await runMobilityAggregation(new Date());
    expect(summary.hotspots).toBeGreaterThanOrEqual(1);
    expect((await aggregated).hotspots).toBe(summary.hotspots);
    socket.disconnect();

    const hotspots = await request(app).get('/api/admin/hotspots').set(auth('admin'));
    const entrance = hotspots.body.items.find((h: { edge: { id: string } | null }) => h.edge?.id === KEY_EDGES.bMainEntranceSteps);
    // 7 synthetic users + Yacine's own report from the ingestion tests above
    expect(entrance).toMatchObject({ edge: { description: 'Entrée principale Bloc B', hasStairs: true } });
    expect(entrance.contributorCount).toBeGreaterThanOrEqual(7);
    expect(entrance.byCategory.WHEELCHAIR).toBe(entrance.contributorCount);

    const corrections = await request(app).get('/api/admin/corrections?status=PENDING').set(auth('admin'));
    expect(corrections.body.items.find((c: { edgeId: string }) => c.edgeId === KEY_EDGES.bMainEntranceSteps)).toMatchObject({ kind: 'MISSING_FEATURE', source: 'CROWD', status: 'PENDING' });

    const recs = await request(app).get('/api/admin/recommendations?lang=en').set(auth('admin'));
    const ramp = recs.body.items.find((r: { edgeId: string }) => r.edgeId === KEY_EDGES.bMainEntranceSteps);
    expect(ramp).toMatchObject({ kind: 'RAMP', status: 'OPEN' });
    expect(ramp.score).toBeGreaterThan(0);
    expect(ramp.rationale).toMatch(/^\d+(\.\d)? wheelchair trips\/week take a 1\d\d m detour because Entrée principale Bloc B has 3 steps \(\d+ % get stuck or blocked there\)\.$/);
    expect(ramp.evidence).toMatchObject({ category: 'WHEELCHAIR', noAlternative: false });

    // Admin decisions survive the next engine run.
    await request(app).patch(`/api/admin/recommendations/${ramp.id}`).set(auth('admin')).send({ status: 'PLANNED' });
    await runMobilityAggregation(new Date());
    expect((await prisma.recommendation.findUniqueOrThrow({ where: { id: ramp.id } })).status).toBe('PLANNED');
  });

  it('a student is refused on /admin', async () => {
    const socket = connect(url, { auth: { token: tokens.yacine }, transports: ['websocket'], forceNew: true });
    const err = await new Promise<Error>((r) => socket.once('connect_error', r));
    expect(err.message).toBe('FORBIDDEN');
    socket.disconnect();
  });

  it('stats suppress small groups', async () => {
    const res = await request(app).get('/api/admin/stats').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body.kMin).toBe(5);
    expect(res.body.categories7d.every((c: { contributors: number }) => c.contributors >= 5)).toBe(true);
  });
});

describe('map corrections: never automatic, approval updates the passage and reroutes', () => {
  it('approve → NavEdge updated, route:invalidated; reject; no double review; invalid proposals refused', async () => {
    const plan = await request(app).post('/api/routes/plan').send({ from: { type: 'node', id: 'O-GATE' }, to: { type: 'node', id: 'O-COUR-N' } });
    const routeId = plan.body.routeId as string;
    expect(plan.body.options[0].edgeIds).toContain('E-O-PLAZA--O-COUR-N');

    const correction = await prisma.mapCorrection.create({
      data: { kind: 'EDGE_CLOSED', source: 'CROWD', title: 'Allée bloquée', description: 'test', edgeId: 'E-O-PLAZA--O-COUR-N', proposed: { isOpen: false, closedReason: 'Chantier' }, x: 110, y: 57 },
    });
    expect((await prisma.navEdge.findUniqueOrThrow({ where: { id: 'E-O-PLAZA--O-COUR-N' } })).isOpen).toBe(true); // pending ≠ applied

    const invalidated = new Promise<{ routeId: string; edgeId: string | null }>((resolve) => {
      const off = bus.on('route.invalidated', (e) => {
        if (e.routeId === routeId) {
          off();
          resolve(e);
        }
      });
    });
    const approve = await request(app).post(`/api/admin/corrections/${correction.id}/approve`).set(auth('admin')).send({ note: 'Vu sur place' });
    expect(approve.status).toBe(200);
    expect(approve.body).toMatchObject({ correction: { status: 'ACCEPTED', reviewedBy: 'Administration du campus' }, applied: { isOpen: false, closedReason: 'Chantier' } });
    expect((await prisma.navEdge.findUniqueOrThrow({ where: { id: 'E-O-PLAZA--O-COUR-N' } })).isOpen).toBe(false);
    expect(await invalidated).toMatchObject({ edgeId: 'E-O-PLAZA--O-COUR-N' });

    expect((await request(app).post(`/api/admin/corrections/${correction.id}/approve`).set(auth('admin')).send({})).status).toBe(409);

    const reopen = await prisma.mapCorrection.create({ data: { kind: 'EDGE_REOPENED', source: 'ADMIN', title: 'Réouverture', description: 'test', edgeId: 'E-O-PLAZA--O-COUR-N', proposed: { isOpen: true } } });
    const done = await request(app).post(`/api/admin/corrections/${reopen.id}/approve`).set(auth('admin')).send({});
    expect(done.body.applied).toEqual({ isOpen: true, closedReason: null });

    const bad = await prisma.mapCorrection.create({ data: { kind: 'OTHER', source: 'CROWD', title: 'x', description: 'x', edgeId: 'E-O-PLAZA--O-COUR-N', proposed: { teleport: true } } });
    expect((await request(app).post(`/api/admin/corrections/${bad.id}/approve`).set(auth('admin')).send({})).status).toBe(422);
    const rejected = await request(app).post(`/api/admin/corrections/${bad.id}/reject`).set(auth('admin')).send({ note: 'Pas pertinent' });
    expect(rejected.body.correction.status).toBe('REJECTED');
  });
});

describe('background detectors', () => {
  it('detects STUCK away from rooms, but not while waiting inside a room; and a U-turn at the steep ramp', async () => {
    const t = Date.now() - 20 * 60_000;
    const make = async (pseudoId: string, pts: { s: number; x: number; y: number }[]) => {
      const s = await prisma.trackingSession.create({
        data: { pseudoId, dayKey: algiersDayKey(new Date()), mobility: 'WHEELCHAIR', startedAt: new Date(t), pointCount: pts.length, lastPointAt: new Date(t + pts.at(-1)!.s * 1000) },
      });
      await prisma.trackPoint.createMany({ data: pts.map((p) => ({ sessionId: s.id, recordedAt: new Date(t + p.s * 1000), x: p.x, y: p.y, level: 0, accuracyM: 3 })) });
      return s.id;
    };
    const dwell = (x: number, y: number) => Array.from({ length: 70 }, (_, i) => ({ s: i * 2, x: x + (i % 3) * 0.5, y: y + (i % 2) * 0.5 }));
    const outdoor = await make('det-out', dwell(150, 60));
    const inRoom = await make('det-room', dwell(64, 107)); // inside the library
    const ramp = await make('det-ramp', [
      ...Array.from({ length: 8 }, (_, i) => ({ s: i * 2, x: 112 - i * 0.4, y: 88 + i * 1.5 })),
      ...Array.from({ length: 8 }, (_, i) => ({ s: 16 + i * 2, x: 109 + i * 0.4, y: 99 - i * 1.5 })),
    ]);

    await runDetectors(new Date());
    const events = await prisma.difficultyEvent.findMany({ where: { sessionId: { in: [outdoor, inRoom, ramp] } } });
    expect(events.filter((e) => e.sessionId === outdoor)).toMatchObject([{ type: 'STUCK', detector: 'DWELL' }]);
    expect(events.filter((e) => e.sessionId === inRoom)).toEqual([]);
    expect(events.filter((e) => e.sessionId === ramp)).toMatchObject([{ type: 'REROUTED', detector: 'U_TURN_AT_OBSTACLE', edgeId: KEY_EDGES.libraryRamp }]);

    await runDetectors(new Date()); // idempotent
    expect(await prisma.difficultyEvent.count({ where: { sessionId: { in: [outdoor, inRoom, ramp] } } })).toBe(events.length);
  });
});

describe('retention', () => {
  it('deletes raw data and pseudonym salts older than 30 days, keeps the rest', async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    const oldDay = algiersDayKey(old);
    await prisma.pseudonymSalt.create({ data: { dayKey: oldDay, salt: 'old' } });
    const s = await prisma.trackingSession.create({ data: { pseudoId: 'retention', dayKey: oldDay, mobility: 'NONE', startedAt: old, endedAt: old, endReason: 'USER' } });
    await prisma.trackPoint.create({ data: { sessionId: s.id, recordedAt: old, x: 100, y: 50, level: 0 } });
    const recent = await prisma.trackPoint.count();

    const res = await purgeExpiredRawData(new Date());
    expect(res).toMatchObject({ sessions: 1, salts: 1 });
    expect(res.points).toBeGreaterThanOrEqual(1);
    expect(await prisma.pseudonymSalt.count({ where: { dayKey: oldDay } })).toBe(0);
    expect(await prisma.trackPoint.count()).toBe(recent - 1);
  });
});
