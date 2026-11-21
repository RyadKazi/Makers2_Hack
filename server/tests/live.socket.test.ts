import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findStatusTransitions } from '../src/jobs/roomStatusTicker.js';
import { bus } from '../src/lib/events.js';
import { createSocketServer } from '../src/sockets/index.js';
import { prisma, roomId, seedTestDatabase, testApp, tokenFor } from './helpers/fixtures.js';

let app: Express;
let http: HttpServer;
let sockets: ReturnType<typeof createSocketServer>;
let url: string;
let floorIds: Map<string, string>;
const clients: Socket[] = [];

beforeAll(async () => {
  ({ floorIds } = await seedTestDatabase());
  app = testApp();
  http = createServer(app);
  sockets = createSocketServer(http);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/live`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await sockets.close();
  http.close();
  await prisma.$disconnect();
});

function client(lang: string): Socket {
  const socket = connect(url, { auth: { lang }, transports: ['websocket'], forceNew: true });
  clients.push(socket);
  return socket;
}

type JoinAck = { ok: boolean; error?: string; statuses?: { code: string; status: { status: string; label: string } }[] };
const join = (socket: Socket, floorId: string): Promise<JoinAck> => socket.timeout(5000).emitWithAck('floor:join', { floorId });
const next = <T>(socket: Socket, event: string, predicate: (payload: T) => boolean = () => true): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within 5 s`)), 5000);
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

describe('namespace /live', () => {
  it('joins a floor room and returns a status snapshot in the socket language', async () => {
    const socket = client('en');
    const ack = await join(socket, floorIds.get('A1')!);
    expect(ack.ok).toBe(true);
    const a104 = ack.statuses!.find((s) => s.code === 'A-104')!;
    expect(a104.status).toMatchObject({ status: 'TEACHER', label: 'Occupied — teacher' });
  });

  it('refuses unknown floors and malformed payloads', async () => {
    const socket = client('fr');
    expect(await join(socket, 'nope')).toEqual({ ok: false, error: 'FLOOR_NOT_FOUND' });
    expect(await socket.timeout(5000).emitWithAck('floor:join', { floor: 1 })).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('pushes room:status to that floor, per language, when a reservation is created', async () => {
    const fr = client('fr');
    const ar = client('ar');
    const other = client('fr');
    await Promise.all([join(fr, floorIds.get('A0')!), join(ar, floorIds.get('A0')!), join(other, floorIds.get('B2')!)]);

    let leaked = false;
    other.on('room:status', () => (leaked = true));
    const frEvent = next<{ code: string; status: { status: string; label: string; occupantName: string } }>(fr, 'room:status', (p) => p.code === 'A-011');
    const arEvent = next<{ code: string; status: { label: string } }>(ar, 'room:status', (p) => p.code === 'A-011');

    const teacher = await tokenFor(app, 'benali');
    const now = Date.now();
    const created = await request(app)
      .post('/api/reservations')
      .set('Authorization', `Bearer ${teacher}`)
      .send({ roomId: await roomId('A-011'), title: 'Tutorat', startsAt: new Date(now).toISOString(), endsAt: new Date(now + 1_800_000).toISOString() });
    expect(created.status).toBe(201);

    expect((await frEvent).status).toMatchObject({ status: 'TEACHER', label: 'Occupée — enseignant', occupantName: 'Dr. Benali' });
    expect((await arEvent).status.label).toBe('مشغولة — أستاذ');
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
  });

  it('pushes edge:status to the outdoor room when an admin closes a path', async () => {
    const socket = client('fr');
    await join(socket, 'outdoor');
    const event = next<{ edgeId: string; isOpen: boolean; closedReason: string }>(socket, 'edge:status', (p) => p.edgeId === 'E-O-B-SIDE--B0-SIDE');
    const admin = await tokenFor(app, 'admin');
    await request(app)
      .patch('/api/admin/edges/E-O-B-SIDE--B0-SIDE/status')
      .set('Authorization', `Bearer ${admin}`)
      .send({ isOpen: false, closedReason: 'Travaux sur la rampe' });
    expect(await event).toMatchObject({ isOpen: false, closedReason: 'Travaux sur la rampe', floorId: 'outdoor' });
  });
});

describe('room status ticker', () => {
  it('finds rooms whose reservations started or ended in a time window', async () => {
    // Seed: A-104 started 30 min ago, B-212 15 min ago.
    const ids = await findStatusTransitions(new Date(Date.now() - 40 * 60_000), new Date());
    const codes = (await prisma.room.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['A-104', 'B-212']));
    expect(await findStatusTransitions(new Date(Date.now() - 60_000), new Date(Date.now() - 59_000))).toEqual([]);
  });

  it('a transition published on the bus reaches clients as room:status', async () => {
    const socket = client('en');
    await join(socket, floorIds.get('B2')!);
    const event = next<{ code: string; status: { status: string } }>(socket, 'room:status', (p) => p.code === 'B-212');
    bus.emit('rooms.changed', { roomIds: [await roomId('B-212')] });
    expect((await event).status.status).toBe('CLUB');
  });
});
