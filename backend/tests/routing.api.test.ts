import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSocketServer } from '../src/sockets/index.js';
import { prisma, seedTestDatabase, testApp, tokenFor } from './helpers/fixtures.js';

let app: Express;
let admin: string;
let yacine: string;
let amina: string;

const GATE = { type: 'node', id: 'O-GATE' } as const;
const room = (code: string) => ({ type: 'room', id: code }) as const;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setEdge(id: string, isOpen: boolean, closedReason?: string) {
  const res = await request(app).patch(`/api/admin/edges/${id}/status`).set(auth(admin)).send(isOpen ? { isOpen } : { isOpen, closedReason });
  expect(res.status).toBe(200);
}

type Option = { id: string; stepFree: boolean; distanceM: number; etaSec: number; travelMode: string; elevatorCount: number; rampCount: number; stairsCount: number; edgeIds: string[]; nodeIds: string[]; steps: { type: string; instruction: string }[]; geojson: { floorId: string | null; level: number; featureCollection: { features: unknown[] } }[] };

beforeAll(async () => {
  await seedTestDatabase();
  app = testApp();
  [admin, yacine, amina] = (await Promise.all(['admin', 'yacine', 'amina'].map((k) => tokenFor(app, k)))) as [string, string, string];
});
afterAll(() => prisma.$disconnect());

describe('POST /api/routes/plan', () => {
  it('anonymous: fastest (3 steps + stairs) and step-free (side entrance + elevator)', async () => {
    const res = await request(app).post('/api/routes/plan').send({ from: GATE, to: room('B-212') });
    expect(res.status).toBe(200);
    expect(res.body.routeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.engine).toBe('stand-in-dijkstra');
    expect(res.body.to).toMatchObject({ type: 'room', name: expect.stringContaining('B-212'), level: 2 });

    const [fastest, stepFree] = res.body.options as Option[];
    expect(fastest).toMatchObject({ id: 'fastest', stepFree: false, travelMode: 'walking', elevatorCount: 0 });
    expect(fastest!.stairsCount).toBe(2); // 3 entrance steps + one stair flight to floor 2
    expect(stepFree).toMatchObject({ id: 'step-free', stepFree: true, elevatorCount: 1, stairsCount: 0, rampCount: 1 });
    expect(stepFree!.distanceM).toBeGreaterThan(fastest!.distanceM);
    expect(stepFree!.etaSec).toBeGreaterThan(0);
    expect(res.body.unavailable).toEqual([]);

    // GeoJSON per floor: outdoors, B0 (entrance + elevator) and B2 (corridor)
    const levels = stepFree!.geojson.map((g) => g.level).sort();
    expect(levels).toEqual([0, 0, 2]);
    expect(stepFree!.geojson.find((g) => g.floorId === null)!.featureCollection.features.length).toBeGreaterThan(3);
  });

  it('applies the signed-in wheelchair profile: one step-free option at wheelchair speed', async () => {
    const res = await request(app).post('/api/routes/plan').set(auth(yacine)).send({ from: GATE, to: room('B-212'), lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.travelMode).toBe('wheelchair');
    expect(res.body.options).toHaveLength(1);
    const [opt] = res.body.options as (Option & { constraints: Record<string, unknown> })[];
    expect(opt).toMatchObject({ id: 'step-free', travelMode: 'wheelchair' });
    expect(opt!.constraints).toMatchObject({ avoidStairs: true, verifiedRampsOnly: true, maxSlopePercent: 6, minDoorWidthCm: 85 });
    expect(opt!.steps.at(-1)!.instruction).toMatch(/^You have arrived/);

    const anonymous = await request(app).post('/api/routes/plan').send({ from: GATE, to: room('B-212'), mode: 'walking', options: ['step-free'] });
    expect(opt!.etaSec).toBeGreaterThan(anonymous.body.options[0].etaSec);
  });

  it('explains which constraint blocks the route (A-102: 75 cm door for an 85 cm minimum)', async () => {
    const res = await request(app).post('/api/routes/plan').set(auth(yacine)).send({ from: GATE, to: room('A-102'), lang: 'fr' });
    expect(res.status).toBe(200);
    expect(res.body.routeId).toBeNull();
    expect(res.body.options).toEqual([]);
    const [why] = res.body.unavailable;
    expect(why).toMatchObject({ option: 'step-free', reason: 'CONSTRAINT' });
    expect(why.blockers).toEqual([
      expect.objectContaining({ constraint: 'minDoorWidthCm', edges: [expect.objectContaining({ value: 75, limit: 85, description: 'Porte A-102' })] }),
    ]);
    expect(why.message).toBe('Passage trop étroit : 75 cm pour 85 cm minimum (Porte A-102).');
  });

  it('request overrides beat the profile (useProfile: false, explicit constraints)', async () => {
    const res = await request(app)
      .post('/api/routes/plan')
      .set(auth(yacine))
      .send({ from: GATE, to: room('A-102'), constraints: { useProfile: false, avoidStairs: true } });
    expect(res.body.options).toHaveLength(1);
    expect(res.body.options[0].id).toBe('step-free');
  });

  it('turns on shoreline hints for a blind profile (Amina, Arabic)', async () => {
    const res = await request(app).post('/api/routes/plan').set(auth(amina)).send({ from: GATE, to: room('A-104'), lang: 'ar' });
    const steps = res.body.options[0].steps as { instruction: string; shoreline: unknown }[];
    expect(steps.some((s) => s.shoreline && /الجدار|الحافة|جدران|حواف/.test(s.instruction))).toBe(true);
  });

  it('snaps a raw position to the graph (PostGIS nearest node)', async () => {
    const res = await request(app).post('/api/routes/plan').send({ from: { type: 'point', x: 109, y: 38, level: 0 }, to: room('A-BIB') });
    expect(res.status).toBe(200);
    expect(res.body.from).toMatchObject({ type: 'point', nodeId: 'O-PLAZA' });
    expect(res.body.from.snappedDistanceM).toBeCloseTo(2.2, 1);
    const far = await request(app).post('/api/routes/plan').send({ from: { type: 'point', x: 900, y: 900, level: 0 }, to: room('A-BIB') });
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('LOCATION_OFF_GRAPH');
  });

  it('validates input', async () => {
    expect((await request(app).post('/api/routes/plan').send({ from: GATE })).status).toBe(400);
    expect((await request(app).post('/api/routes/plan').send({ from: GATE, to: { type: 'room', id: 'Z-999' } })).status).toBe(404);
    expect((await request(app).post('/api/routes/plan').send({ from: GATE, to: room('B-212'), constraints: { teleport: true } })).status).toBe(400);
  });
});

describe('closed elevator', () => {
  beforeEach(async () => {
    await setEdge('E-A1-C78--B1-C02', false, 'Passerelle fermée : travaux d’étanchéité');
    await setEdge('E-B0-ELEV--B1-ELEV', true);
  });

  it('no step-free route when the only elevator is out: the closed passages are named', async () => {
    await setEdge('E-B0-ELEV--B1-ELEV', false, 'Ascenseur en panne');
    const res = await request(app).post('/api/routes/plan').set(auth(yacine)).send({ from: GATE, to: room('B-212'), lang: 'en' });
    expect(res.body.options).toEqual([]);
    const [why] = res.body.unavailable;
    expect(why.reason).toBe('CONSTRAINT');
    // Two independent ways out: reopen the elevator, or accept stairs.
    const byKey = Object.fromEntries(why.blockers.map((b: { constraint: string }) => [b.constraint, b]));
    expect(Object.keys(byKey).sort()).toEqual(['avoidStairs', 'closedPassages']);
    expect(byKey.closedPassages.edges[0]).toMatchObject({ edgeId: 'E-B0-ELEV--B1-ELEV', description: 'Ascenseur Bloc B', value: 'Ascenseur en panne' });
    expect(why.message).toContain('The only possible way is closed: Ascenseur Bloc B (Ascenseur en panne).');
    expect(why.message).toContain('Every route uses steps or stairs');
  });
});

describe('POST /api/routes/:id/recheck', () => {
  let http: HttpServer;
  let sockets: ReturnType<typeof createSocketServer>;
  let client: Socket;

  beforeAll(async () => {
    http = createServer(app);
    sockets = createSocketServer(http);
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    client = connect(`http://127.0.0.1:${(http.address() as AddressInfo).port}/live`, { transports: ['websocket'], forceNew: true });
  });
  afterAll(async () => {
    client.disconnect();
    await sockets.close();
    http.close();
  });

  beforeEach(async () => {
    await setEdge('E-A1-C78--B1-C02', false, 'Passerelle fermée : travaux d’étanchéité');
    await setEdge('E-B0-ELEV--B1-ELEV', true);
  });

  const plan = async () => (await request(app).post('/api/routes/plan').set(auth(yacine)).send({ from: GATE, to: room('B-212') })).body as { routeId: string; options: Option[] };
  const recheck = (id: string, position: object, lang = 'en') => request(app).post(`/api/routes/${id}/recheck`).send({ position, lang });

  it('ON_ROUTE with progress, then ARRIVED at the door', async () => {
    const { routeId, options } = await plan();
    const onRoute = await recheck(routeId, { x: 110.5, y: 30, level: 0 });
    expect(onRoute.status).toBe(200);
    expect(onRoute.body).toMatchObject({ status: 'ON_ROUTE', reason: null, version: 1, route: null });
    expect(onRoute.body.progress.completedM).toBeCloseTo(25, 0);
    expect(onRoute.body.progress.remainingM).toBeCloseTo(options[0]!.distanceM - 25, 0);
    expect(onRoute.body.progress.nextStepIndex).toBe(1);

    const arrived = await recheck(routeId, { x: 144, y: 101, level: 2 });
    expect(arrived.body.status).toBe('ARRIVED');
  });

  it('OFF_ROUTE → rerouted from the current position, and route:invalidated is pushed', async () => {
    const { routeId } = await plan();
    expect(await client.timeout(5000).emitWithAck('route:watch', { routeId })).toEqual({ ok: true });
    const event = new Promise<{ routeId: string; reason: string; rerouted: boolean; version: number }>((resolve) => client.once('route:invalidated', resolve));

    const res = await recheck(routeId, { x: 40, y: 40, level: 0 }); // at the cafeteria, far from the route
    expect(res.body).toMatchObject({ status: 'REROUTED', reason: 'OFF_ROUTE', version: 2 });
    expect(res.body.route.nodeIds[0]).toBe('O-CAFE');
    expect(res.body.message).toBe('You left the route: new route calculated.');
    expect(await event).toMatchObject({ routeId, reason: 'OFF_ROUTE', rerouted: true, version: 2 });
  });

  it('closing the elevator on the route pushes route:invalidated, then recheck reroutes via the footbridge', async () => {
    await setEdge('E-A1-C78--B1-C02', true); // reopen the footbridge: an alternative exists
    const { routeId, options } = await plan();
    expect(options[0]!.edgeIds).toContain('E-B0-ELEV--B1-ELEV');
    await client.timeout(5000).emitWithAck('route:watch', { routeId });

    const pushed = new Promise<{ reason: string; edgeId: string; rerouted: boolean }>((resolve) => client.once('route:invalidated', resolve));
    await setEdge('E-B0-ELEV--B1-ELEV', false, 'Ascenseur en panne');
    expect(await pushed).toMatchObject({ reason: 'EDGE_CLOSED', edgeId: 'E-B0-ELEV--B1-ELEV', rerouted: false });

    const res = await recheck(routeId, { x: 110, y: 30, level: 0 }, 'fr');
    expect(res.body).toMatchObject({ status: 'REROUTED', reason: 'EDGE_CLOSED', blockedEdge: { edgeId: 'E-B0-ELEV--B1-ELEV', closedReason: 'Ascenseur en panne' } });
    expect(res.body.message).toMatch(/^Passage fermé sur votre itinéraire/);
    expect(res.body.route.edgeIds).not.toContain('E-B0-ELEV--B1-ELEV');
    expect(res.body.route.edgeIds).toContain('E-A1-C78--B1-C02');
  });

  it('NO_ROUTE with an explanation when nothing is left', async () => {
    const { routeId } = await plan();
    await setEdge('E-B0-ELEV--B1-ELEV', false, 'Ascenseur en panne');
    const res = await recheck(routeId, { x: 110, y: 30, level: 0 });
    expect(res.body).toMatchObject({ status: 'NO_ROUTE', reason: 'EDGE_CLOSED', route: null });
    expect(res.body.unavailable.blockers[0].constraint).toBe('closedPassages');
  });

  it('404 for unknown routes, 400 for bad ids', async () => {
    expect((await recheck('00000000-0000-4000-8000-000000000000', { x: 0, y: 0, level: 0 })).status).toBe(404);
    expect((await recheck('nope', { x: 0, y: 0, level: 0 })).status).toBe(400);
  });
});
