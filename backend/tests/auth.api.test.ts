import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, seedTestDatabase, TEST_PASSWORD, testApp, tokenFor } from './helpers/fixtures.js';

let app: Express;

beforeAll(async () => {
  await seedTestDatabase();
  app = testApp();
});
afterAll(() => prisma.$disconnect());

const refreshCookie = (res: request.Response): string => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('cw_rt='));
  if (!cookie) throw new Error('no refresh cookie');
  return cookie;
};

describe('register / login', () => {
  it('registers a STUDENT, returns an access token and sets an httpOnly refresh cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'Nour.B@Campusway.local', password: 'a-strong-password', displayName: 'Nour B.', locale: 'ar' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900, user: { email: 'nour.b@campusway.local', role: 'STUDENT', locale: 'ar' } });
    expect(res.body.user.accessibilityProfile).toMatchObject({ mobility: 'NONE', updatedAt: null });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('refuses duplicates, self-assigned roles and weak passwords', async () => {
    const dup = await request(app).post('/api/auth/register').send({ email: 'nour.b@campusway.local', password: 'a-strong-password', displayName: 'Nour' });
    expect(dup.status).toBe(409);
    const role = await request(app).post('/api/auth/register').send({ email: 'x@campusway.local', password: 'a-strong-password', displayName: 'X', role: 'ADMIN' });
    expect(role.status).toBe(400);
    const weak = await request(app).post('/api/auth/register').send({ email: 'y@campusway.local', password: 'short', displayName: 'Y' });
    expect(weak.status).toBe(400);
  });

  it('rejects wrong credentials with the same message for unknown emails', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: 'benali@campusway.local', password: 'not-the-password' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@campusway.local', password: 'whatever-123' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('logs in a seeded teacher with their role in the session', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'benali@campusway.local', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'TEACHER', displayName: 'Dr. Benali' });
  });

  it('accepts CLUB role access tokens on authenticated endpoints', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'riad@campusway.local', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ role: 'CLUB', displayName: 'Riad S. (président, Robotics Club)' });

    const me = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ role: 'CLUB', displayName: 'Riad S. (président, Robotics Club)' });
  });
});

describe('/api/me', () => {
  it('requires a valid bearer token', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    const bad = await request(app).get('/api/me').set('Authorization', 'Bearer not.a.jwt');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns the profile saved in the seed (Yacine: wheelchair)', async () => {
    const token = await tokenFor(app, 'yacine');
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.accessibilityProfile).toMatchObject({ mobility: 'WHEELCHAIR', stepFree: true, maxSlopePercent: 6, minPassageWidthCm: 85 });
  });

  it('updates display name / locale and the accessibility profile (partial)', async () => {
    const token = await tokenFor(app, 'lina');
    const me = await request(app).put('/api/me').set('Authorization', `Bearer ${token}`).send({ locale: 'fr' });
    expect(me.body.locale).toBe('fr');

    const put = await request(app)
      .put('/api/me/accessibility-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ mobility: 'REDUCED_MOBILITY', maxSlopePercent: 5, textScale: 1.25 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ mobility: 'REDUCED_MOBILITY', maxSlopePercent: 5, textScale: 1.25, stepFree: false });
    expect(put.body.updatedAt).not.toBeNull();

    const second = await request(app).put('/api/me/accessibility-profile').set('Authorization', `Bearer ${token}`).send({ captions: true });
    expect(second.body).toMatchObject({ mobility: 'REDUCED_MOBILITY', captions: true });

    const invalid = await request(app).put('/api/me/accessibility-profile').set('Authorization', `Bearer ${token}`).send({ textScale: 5, unknown: 1 });
    expect(invalid.status).toBe(400);
  });
});

describe('refresh tokens', () => {
  it('rotates the cookie on refresh and is revoked by logout-all', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'amina@campusway.local', password: TEST_PASSWORD });
    const cookie = refreshCookie(login).split(';')[0]!;

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshCookie(refreshed)).toMatch(/^cw_rt=/);

    const logoutAll = await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(logoutAll.status).toBe(204);

    const revoked = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects a missing cookie and an access token used as refresh token', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    const access = await tokenFor(app, 'karim');
    expect((await request(app).post('/api/auth/refresh').set('Cookie', `cw_rt=${access}`)).status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('rejects replay after refresh and revokes the current cookie on logout', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'karim@campusway.local', password: TEST_PASSWORD });
    const original = refreshCookie(login).split(';')[0]!;

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(refreshed.status).toBe(200);
    const rotated = refreshCookie(refreshed).split(';')[0]!;

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);

    const logout = await request(app).post('/api/auth/logout').set('Cookie', rotated);
    expect(logout.status).toBe(204);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', rotated)).status).toBe(401);
  });
});

describe('role guard', () => {
  it('blocks non-admins from admin endpoints', async () => {
    const teacher = await tokenFor(app, 'haddad');
    const res = await request(app).patch('/api/admin/edges/E-A1-C78--B1-C02/status').set('Authorization', `Bearer ${teacher}`).send({ isOpen: true });
    expect(res.status).toBe(403);
  });
});
