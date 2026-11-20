/**
 * Vitest global setup: an in-process PostgreSQL (PGlite, WASM) with PostGIS and
 * btree_gist, migrated with the real migration files and exposed on a local TCP
 * port so Prisma connects to it like to any Postgres. No Docker needed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { postgis } from '@electric-sql/pglite-postgis';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { TEST_DB_PORT } from './db-port.js';

export default async function setup(): Promise<() => Promise<void>> {
  const db = await PGlite.create({ extensions: { postgis, btree_gist } });

  const migrationsDir = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of migrations) {
    await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'));
  }

  const server = new PGLiteSocketServer({ db, port: TEST_DB_PORT, host: '127.0.0.1', maxConnections: 100 });
  await server.start();

  return async () => {
    await server.stop();
    await db.close();
  };
}
