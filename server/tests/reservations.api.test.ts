import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayAt, prisma, roomId, seedTestDatabase, testApp, tokenFor } from './helpers/fixtures.js';

let app: Express;
let benali: string;
let haddad: string;
let admin: string;
let student: string;
let a101: string;
let b101: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Tomorrow and later have no seeded reservations: a clean calendar for these tests. */
const slot = (from: readonly [number, number], to: readonly [number, number], days = 2) => ({ startsAt: dayAt(days, ...from), endsAt: dayAt(days, ...to) });

beforeAll(async () => {
  await seedTestDatabase();
  app = testApp();
  [benali, haddad, admin, student] = (await Promise.all(['benali', 'haddad', 'admin', 'yacine'].map((k) => tokenFor(app, k)))) as [string, string, string, string];
  [a101, b101] = await Promise.all([roomId('A-101'), roomId('B-101')]);
});
afterAll(() => prisma.$disconnect());

describe('POST /api/reservations — roles', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/reservations').send({ roomId: a101, title: 'Cours', ...slot([8, 0], [9, 30]) });
    expect(res.status).toBe(401);
  });

  it('forbids students', async () => {
    const res = await request(app).post('/api/reservations').set(auth(student)).send({ roomId: a101, title: 'Révisions', ...slot([8, 0], [9, 30]) });
    expect(res.status).toBe(403);
  });

  it('lets a teacher book a teaching session under their own name', async () => {
    const res = await request(app).post('/api/reservations').set(auth(benali)).send({ roomId: a101, title: 'Compilation — Cours M1', ...slot([8, 0], [9, 30]) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ roomCode: 'A-101', kind: 'TEACHER', organizer: 'Dr. Benali', title: 'Compilation — Cours M1' });
    expect(res.body.ownerId).toBeTruthy();
  });

  it('does not let a teacher impersonate someone else or create ADMIN reservations', async () => {
    const other = await request(app)
      .post('/api/reservations')
      .set(auth(benali))
      .send({ roomId: a101, title: 'Cours', organizer: 'Mme. Haddad', ...slot([14, 40], [16, 10]) });
    expect(other.status).toBe(403);
    const adminKind = await request(app).post('/api/reservations').set(auth(benali)).send({ roomId: a101, kind: 'ADMIN', title: 'Conseil', ...slot([14, 40], [16, 10]) });
    expect(adminKind.status).toBe(403);
  });

  it('requires the club name for CLUB reservations', async () => {
    const missing = await request(app).post('/api/reservations').set(auth(haddad)).send({ roomId: b101, kind: 'CLUB', title: 'Atelier', ...slot([16, 20], [17, 50]) });
    expect(missing.status).toBe(400);
    const ok = await request(app)
      .post('/api/reservations')
      .set(auth(haddad))
      .send({ roomId: b101, kind: 'CLUB', organizer: 'Robotics Club', title: 'Atelier capteurs', ...slot([16, 20], [17, 50]) });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ kind: 'CLUB', organizer: 'Robotics Club' });
  });
});

describe('overlap validation', () => {
  let first: { id: string };

  beforeAll(async () => {
    const res = await request(app).post('/api/reservations').set(auth(benali)).send({ roomId: a101, title: 'Réseaux — TD', ...slot([9, 40], [11, 10], 3) });
    expect(res.status).toBe(201);
    first = res.body;
  });

  it.each([
    ['starts inside', [10, 0], [11, 30]],
    ['ends inside', [9, 0], [10, 0]],
    ['inside', [10, 0], [10, 30]],
    ['covers it', [9, 0], [12, 0]],
    ['identical', [9, 40], [11, 10]],
  ] as const)('rejects a reservation that %s with 409 and the conflicting reservation', async (_name, from, to) => {
    const res = await request(app).post('/api/reservations').set(auth(haddad)).send({ roomId: a101, title: 'Autre cours', ...slot(from, to, 3) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESERVATION_CONFLICT');
    expect(res.body.error.details.conflicts.map((c: { id: string }) => c.id)).toEqual([first.id]);
  });

  it('accepts back-to-back sessions on both sides', async () => {
    const before = await request(app).post('/api/reservations').set(auth(haddad)).send({ roomId: a101, title: 'Avant', ...slot([8, 10], [9, 40], 3) });
    const after = await request(app).post('/api/reservations').set(auth(haddad)).send({ roomId: a101, title: 'Après', ...slot([11, 10], [12, 40], 3) });
    expect([before.status, after.status]).toEqual([201, 201]);
  });

  it('accepts the same slot in another room', async () => {
    const res = await request(app).post('/api/reservations').set(auth(haddad)).send({ roomId: b101, title: 'Ailleurs', ...slot([9, 40], [11, 10], 3) });
    expect(res.status).toBe(201);
  });

  it('lets exactly one of two simultaneous requests win', async () => {
    const body = { roomId: b101, title: 'Course', ...slot([13, 0], [14, 30], 4) };
    const results = await Promise.all([
      request(app).post('/api/reservations').set(auth(benali)).send(body),
      request(app).post('/api/reservations').set(auth(haddad)).send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('is enforced by the database too (EXCLUDE constraint), even bypassing the API', async () => {
    const { startsAt, endsAt } = slot([10, 0], [10, 45], 3);
    await expect(
      prisma.reservation.create({ data: { roomId: a101, kind: 'TEACHER', title: 'Direct', organizer: 'x', startsAt: new Date(startsAt), endsAt: new Date(endsAt) } }),
    ).rejects.toThrow(/reservations_no_overlap|23P01|exclusion/i);
  });

  it('validates the interval itself', async () => {
    const reversed = await request(app).post('/api/reservations').set(auth(benali)).send({ roomId: a101, title: 'Inversé', ...slot([12, 0], [11, 0], 5) });
    expect(reversed.body.error).toMatchObject({ code: 'INVALID_INTERVAL', details: { problem: 'END_BEFORE_START' } });
    const past = await request(app)
      .post('/api/reservations')
      .set(auth(benali))
      .send({ roomId: a101, title: 'Passé', startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 1_800_000).toISOString() });
    expect(past.body.error.details.problem).toBe('IN_PAST');
    const tooLong = await request(app).post('/api/reservations').set(auth(benali)).send({ roomId: a101, title: 'Marathon', ...slot([7, 0], [20, 0], 5) });
    expect(tooLong.body.error.details.problem).toBe('TOO_LONG');
  });

  it('404s on an unknown room', async () => {
    const res = await request(app).post('/api/reservations').set(auth(benali)).send({ roomId: 'nope', title: 'Salle fantôme', ...slot([8, 0], [9, 0], 5) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH / DELETE', () => {
  let mine: { id: string };

  beforeAll(async () => {
    const res = await request(app).post('/api/reservations').set(auth(benali)).send({ roomId: a101, title: 'Sécurité — Cours', ...slot([13, 0], [14, 30], 6) });
    mine = res.body;
    await request(app).post('/api/reservations').set(auth(haddad)).send({ roomId: a101, title: 'Voisin', ...slot([14, 40], [16, 10], 6) });
  });

  it('lets the owner move their reservation, ignoring itself in the overlap check', async () => {
    const res = await request(app).patch(`/api/reservations/${mine.id}`).set(auth(benali)).send(slot([13, 15], [14, 40], 6));
    expect(res.status).toBe(200);
    expect(res.body.endsAt).toBe(dayAt(6, 14, 40));
  });

  it('rejects a move onto another reservation', async () => {
    const res = await request(app).patch(`/api/reservations/${mine.id}`).set(auth(benali)).send({ endsAt: dayAt(6, 15, 0) });
    expect(res.status).toBe(409);
    expect(res.body.error.details.conflicts[0].title).toBe('Voisin');
  });

  it("forbids changing another teacher's reservation; admins can", async () => {
    const other = await request(app).patch(`/api/reservations/${mine.id}`).set(auth(haddad)).send({ title: 'Piraté' });
    expect(other.status).toBe(403);
    const byAdmin = await request(app).patch(`/api/reservations/${mine.id}`).set(auth(admin)).send({ title: 'Sécurité — Cours (salle confirmée)' });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.organizer).toBe('Dr. Benali');
  });

  it('lists reservations by room and range, and "mine"', async () => {
    const from = dayAt(6, 0, 0);
    const to = dayAt(7, 0, 0);
    const res = await request(app).get(`/api/reservations?roomId=${a101}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set(auth(student));
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Sécurité — Cours (salle confirmée)', 'Voisin']);
    const mineOnly = await request(app).get(`/api/reservations?mine=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set(auth(benali));
    expect(mineOnly.body.items.map((r: { id: string }) => r.id)).toEqual([mine.id]);
  });

  it('deletes (owner) then 404s', async () => {
    expect((await request(app).delete(`/api/reservations/${mine.id}`).set(auth(haddad))).status).toBe(403);
    expect((await request(app).delete(`/api/reservations/${mine.id}`).set(auth(benali))).status).toBe(204);
    expect((await request(app).get(`/api/reservations/${mine.id}`).set(auth(benali))).status).toBe(404);
  });

  it('changes the live room status immediately', async () => {
    const free = await request(app).get('/api/rooms/A-001');
    expect(free.body.status.status).toBe('AVAILABLE');
    const now = Date.now();
    const created = await request(app)
      .post('/api/reservations')
      .set(auth(admin))
      .send({ roomId: free.body.id, kind: 'ADMIN', title: 'Permanence inscriptions', startsAt: new Date(now).toISOString(), endsAt: new Date(now + 3_600_000).toISOString() });
    expect(created.status).toBe(201);
    const busy = await request(app).get('/api/rooms/A-001?lang=en');
    expect(busy.body.status).toMatchObject({ status: 'ADMIN', label: 'Occupied — administration', occupantName: 'Administration du campus' });
  });
});
