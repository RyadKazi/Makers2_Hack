import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { algiersDayBounds } from '../src/lib/time.js';
import { prisma, seedTestDatabase, testApp, tokenFor } from './helpers/fixtures.js';

let app: Express;

beforeAll(async () => {
  await seedTestDatabase();
  app = testApp();
});
afterAll(() => prisma.$disconnect());

type RoomItem = { code: string; status: { status: string; label: string; occupantName: string | null; until: string | null; freeAt: string }; stepFreeAccess: boolean; floor: { level: number }; building: { code: string } };

describe('GET /api/rooms', () => {
  it('lists every room with a live status computed from reservations at now', async () => {
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(44);
    const byCode = new Map<string, RoomItem>(res.body.items.map((r: RoomItem) => [r.code, r]));

    const a104 = byCode.get('A-104')!;
    expect(a104.status).toMatchObject({ status: 'TEACHER', occupantName: 'Dr. Benali', label: 'Occupée — enseignant' });
    // Seed: A-104 runs from now-30 to now+60 and has "Soutenances" from now+75: free in the gap.
    const until = new Date(a104.status.until!).getTime();
    expect(until - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(until - Date.now()).toBeLessThan(62 * 60_000);
    expect(a104.status.freeAt).toBe(a104.status.until);

    expect(byCode.get('B-212')!.status).toMatchObject({ status: 'CLUB', occupantName: 'Robotics Club' });

    const a103 = byCode.get('A-103')!;
    expect(a103.status.status).toBe('AVAILABLE');
    expect(new Date(a103.status.until!).getTime() - Date.now()).toBeGreaterThan(110 * 60_000); // next session at now+120
  });

  it('filters by status (comma-separated)', async () => {
    const occupied = await request(app).get('/api/rooms?status=TEACHER,CLUB');
    const codes = occupied.body.items.map((r: RoomItem) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['A-104', 'B-212']));
    expect(occupied.body.items.every((r: RoomItem) => ['TEACHER', 'CLUB'].includes(r.status.status))).toBe(true);

    const free = await request(app).get('/api/rooms?status=AVAILABLE');
    expect(free.body.items.map((r: RoomItem) => r.code)).not.toContain('A-104');
    expect(free.body.total + occupied.body.total).toBeLessThanOrEqual(44);
  });

  it('filters by building, floor, capacity and search', async () => {
    const floors = await request(app).get('/api/campus/buildings/B/floors');
    const b = await request(app).get(`/api/rooms?buildingId=${floors.body.building.id}&floor=2`);
    expect(b.body.total).toBeGreaterThan(0);
    expect(b.body.items.every((r: RoomItem) => r.building.code === 'B' && r.floor.level === 2)).toBe(true);

    const big = await request(app).get('/api/rooms?minCapacity=150');
    expect(big.body.items.map((r: RoomItem) => r.code).sort()).toEqual(['A-BIB', 'B-AMPHI1']);

    const search = await request(app).get('/api/rooms?search=biblioth');
    expect(search.body.items.map((r: RoomItem) => r.code)).toEqual(['A-BIB']);
    const arabic = await request(app).get(`/api/rooms?search=${encodeURIComponent('المدرج')}`);
    expect(arabic.body.items.map((r: RoomItem) => r.code)).toEqual(['B-AMPHI1']);
  });

  it('paginates after filtering', async () => {
    const page = await request(app).get('/api/rooms?limit=5&offset=40');
    expect(page.body.total).toBe(44);
    expect(page.body.items).toHaveLength(4);
  });

  it('localises labels with ?lang= or Accept-Language', async () => {
    const ar = await request(app).get('/api/rooms?search=A-104&lang=ar');
    expect(ar.body.items[0].status.label).toBe('مشغولة — أستاذ');
    const en = await request(app).get('/api/rooms?search=A-104').set('Accept-Language', 'en-GB,en;q=0.9');
    expect(en.body.items[0].status.label).toBe('Occupied — teacher');
  });

  it('rejects invalid filters with every issue listed', async () => {
    const res = await request(app).get('/api/rooms?status=BUSY&floor=abc&stepFree=maybe');
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['floor', 'status', 'stepFree']);
  });

  it('stepFree follows the live graph: closing the step-free side entrance cuts off Bloc B', async () => {
    const before = await request(app).get('/api/rooms?stepFree=false');
    expect(before.body.total).toBe(0); // every room has a step-free route today

    const admin = await tokenFor(app, 'admin');
    const close = await request(app)
      .patch('/api/admin/edges/E-O-B-SIDE--B0-SIDE/status')
      .set('Authorization', `Bearer ${admin}`)
      .send({ isOpen: false, closedReason: 'Porte latérale en réparation' });
    expect(close.status).toBe(200);

    const after = await request(app).get('/api/rooms?stepFree=false');
    expect(after.body.total).toBeGreaterThan(15);
    expect(after.body.items.every((r: RoomItem) => r.building.code === 'B')).toBe(true);

    await request(app).patch('/api/admin/edges/E-O-B-SIDE--B0-SIDE/status').set('Authorization', `Bearer ${admin}`).send({ isOpen: true });
    expect((await request(app).get('/api/rooms?stepFree=false')).body.total).toBe(0);
  });
});

describe('GET /api/rooms/:id', () => {
  it('returns schedule, accessibility and nearest step-free facilities (by code)', async () => {
    const res = await request(app).get('/api/rooms/A-104');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('A-104');
    // Today's schedule (Africa/Algiers calendar day). Near midnight the later session falls on tomorrow.
    const day = algiersDayBounds(new Date());
    for (const r of res.body.schedule as { startsAt: string; endsAt: string; title?: string; organizer?: string; ownerId?: string }[]) {
      expect(new Date(r.startsAt) < day.end && new Date(r.endsAt) > day.start).toBe(true);
      expect(r).not.toHaveProperty('title');
      expect(r).not.toHaveProperty('organizer');
      expect(r).not.toHaveProperty('ownerId');
    }
    expect(res.body.accessibility).toMatchObject({ stepFreeAccess: true, wheelchairAccessible: true, doorClearanceCm: 90 });
    expect(res.body.nearest.elevator).toMatchObject({ type: 'ELEVATOR', level: 1, buildingCode: 'A' });
    expect(res.body.nearest.accessibleToilet).toMatchObject({ type: 'ACCESSIBLE_TOILET', level: 1, buildingCode: 'A' });
    expect(res.body.nearest.elevator.routeDistanceM).toBeGreaterThan(0);
  });

  it('finds the nearest accessible toilet on another floor when needed (Bloc B has one only on the ground floor)', async () => {
    const res = await request(app).get('/api/rooms/B-212');
    expect(res.body.nearest.accessibleToilet).toMatchObject({ level: 0, buildingCode: 'B' });
    expect(res.body.nearest.elevator).toMatchObject({ level: 2, buildingCode: 'B' });
  });

  it('flags narrow doors as not wheelchair accessible', async () => {
    const res = await request(app).get('/api/rooms/A-102');
    expect(res.body.accessibility).toMatchObject({ stepFreeAccess: true, wheelchairAccessible: false, doorClearanceCm: 75 });
  });

  it('also accepts the room id, and 404s on unknown rooms', async () => {
    const list = await request(app).get('/api/rooms?search=B-212');
    const byId = await request(app).get(`/api/rooms/${list.body.items[0].id}`);
    expect(byId.body.code).toBe('B-212');
    const missing = await request(app).get('/api/rooms/Z-999');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
