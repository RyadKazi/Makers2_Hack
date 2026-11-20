/**
 * Seeds the demo campus. Idempotent: truncates every table first.
 *   npm run db:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { buildCampus } from './campus.js';
import { USERS } from './people.js';
import { createRng } from './random.js';
import { resetDatabase, seedCampus, seedMobility, seedPeople } from './steps.js';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

async function main(): Promise<void> {
  const seedPassword = requireEnv('SEED_PASSWORD');
  const rng = createRng(Number(process.env.SEED_RANDOM ?? 20261119));
  const now = new Date();
  const model = buildCampus();

  await resetDatabase(prisma);
  const { floorIds } = await seedCampus(prisma, model);
  const { userIds } = await seedPeople(prisma, now, seedPassword);
  const { cells } = await seedMobility(prisma, model, rng, now, floorIds, userIds);

  console.log(`✅ Seed complete — ${cells} heatmap cells. Demo accounts: ${USERS.map((u) => u.email).join(', ')}`);
}

main()
  .catch((err: unknown) => {
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
