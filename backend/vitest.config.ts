import { defineConfig } from 'vitest/config';
import { TEST_DB_PORT } from './tests/setup/db-port.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-db.ts'],
    // One shared database: run test files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-access-secret-at-least-32-characters!!',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters!',
      BCRYPT_ROUNDS: '4',
      PSEUDONYM_SECRET: 'test-pseudonym-secret-at-least-32-characters',
      ACCESU_NAVIGATION_API_KEY: 'test-navigation-api-key',
      // PGlite has a single backend: one connection per client and no named prepared statements.
      DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres?schema=public&connection_limit=1&sslmode=disable&pgbouncer=true`,
    },
  },
});
