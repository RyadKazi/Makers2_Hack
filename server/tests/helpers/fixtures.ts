import type { Express } from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { buildCampus } from '../../prisma/seed/campus.js';
import { resetDatabase, seedCampus, seedPeople } from '../../prisma/seed/steps.js';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { algiersDayKey, algiersTime } from '../../src/lib/time.js';
import { invalidateCampusGraph } from '../../src/modules/routing/graph.repository.js';

export const TEST_PASSWORD = 'integration-test-password';

/** Fresh database: demo campus + users + today's timetable anchored on `now`. No mobility data. */
export async function seedTestDatabase(now = new Date()) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await resetDatabase(prisma);
    const { floorIds } = await seedCampus(prisma, buildCampus());
    const { userIds } = await seedPeople(prisma, now, TEST_PASSWORD, 4);
    invalidateCampusGraph();
    return { floorIds, userIds };
  } finally {
    log.mockRestore();
  }
}

export function testApp(): Express {
  return createApp({ checkDatabase: async () => true });
}

/** Signs in a seeded demo account ("benali", "admin", "yacine"…) and returns its access token. */
export async function tokenFor(app: Express, key: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email: `${key}@campusway.local`, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login ${key} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export async function roomId(code: string): Promise<string> {
  return (await prisma.room.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
}

/** A local Algiers wall-clock time `days` days from now, as an ISO string. */
export function dayAt(days: number, hours: number, minutes = 0): string {
  return algiersTime(algiersDayKey(new Date(Date.now() + days * 86_400_000)), hours, minutes).toISOString();
}

export { prisma };
