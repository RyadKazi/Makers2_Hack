/**
 * Standalone PGlite database server with PostGIS and btree_gist extensions.
 * Provides a zero-setup local PostgreSQL instance on port 5432 (or DB_PORT)
 * with persistence in server/.pgdata, so Docker or local PostgreSQL is not required.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { postgis } from '@electric-sql/pglite-postgis';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { buildCampus } from '../prisma/seed/campus.js';
import { USERS } from '../prisma/seed/people.js';
import { createRng } from '../prisma/seed/random.js';
import { resetDatabase, seedCampus, seedMobility, seedPeople } from '../prisma/seed/steps.js';

const PORT = Number(process.env.DB_PORT ?? 5433);
const DATA_DIR = join(import.meta.dirname, '..', '.pgdata');
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?schema=public&sslmode=disable&pgbouncer=true`;

export async function startDevDb() {
  console.log(`🚀 Starting in-process PostgreSQL (PGlite + PostGIS) on port ${PORT}...`);
  console.log(`📁 Data directory: ${DATA_DIR}`);

  const db = await PGlite.create({
    dataDir: DATA_DIR,
    extensions: { postgis, btree_gist },
  });

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1', maxConnections: 100 });
  await server.start();
  console.log(`✅ Database listening on 127.0.0.1:${PORT}`);

  // Check if tables exist
  let needsMigrations = false;
  try {
    const tableCheck = await db.query<{ regclass: string | null }>(
      "SELECT to_regclass('public.users') as regclass"
    );
    needsMigrations = !tableCheck.rows[0]?.regclass;
  } catch {
    needsMigrations = true;
  }

  if (needsMigrations) {
    console.log('📦 Applying initial migrations...');
    const migrationsDir = join(import.meta.dirname, '..', 'prisma', 'migrations');
    const migrations = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    for (const name of migrations) {
      console.log(`   Applying migration: ${name}`);
      await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'));
    }
    console.log('✅ Migrations applied successfully.');
  }

  // Check if database needs seeding
  let count = 0;
  try {
    const userCount = await db.query<{ count: string | number }>('SELECT count(*) as count FROM "users"');
    count = Number(userCount.rows[0]?.count ?? 0);
  } catch {
    count = 0;
  }

  if (count === 0) {
    console.log('🌱 Seeding database with demo data (campus, users, mobility)...');
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: `postgresql://campusway:campusway@127.0.0.1:${PORT}/campusway?schema=public`,
        },
      },
    });

    try {
      const seedPassword = process.env.SEED_PASSWORD || 'change-me-demo-password';
      const rng = createRng(Number(process.env.SEED_RANDOM ?? 20261119));
      const now = new Date();
      const model = buildCampus();

      await resetDatabase(prisma);
      const { floorIds } = await seedCampus(prisma, model);
      const { userIds } = await seedPeople(prisma, now, seedPassword);
      const { cells } = await seedMobility(prisma, model, rng, now, floorIds, userIds);

      console.log(`✅ Seed complete — ${cells} heatmap cells. Demo accounts: ${USERS.map((u) => u.email).join(', ')}`);
    } finally {
      await prisma.$disconnect();
    }
  } else {
    console.log(`📊 Database already seeded (${count} users present).`);
  }

  console.log('\n🌟 Database is ready for connections on port ' + PORT + '!');

  const shutdown = async () => {
    console.log('\n🛑 Stopping database...');
    await server.stop();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.includes('dev-db')) {
  startDevDb().catch((err) => {
    console.error('❌ Failed to start dev database:', err);
    process.exit(1);
  });
}
