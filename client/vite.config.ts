/// <reference types="vitest" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // In Docker the API is reachable as http://server:4000; locally on localhost.
  const apiTarget = env.API_PROXY_TARGET ?? 'http://localhost:4000';

  // Read the server's seed password directly rather than via Vite's loadEnv:
  // loadEnv copies NODE_ENV from any .env it parses into VITE_USER_NODE_ENV,
  // which would silently flip a production build into development mode.
  const serverEnvPath = fileURLToPath(new URL('../server/.env', import.meta.url));
  let seedPassword = '';
  if (existsSync(serverEnvPath)) {
    const match = /^\s*SEED_PASSWORD\s*=\s*(.+)$/m.exec(readFileSync(serverEnvPath, 'utf8'));
    seedPassword = match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
  }
  const demoPassword = env.VITE_DEMO_PASSWORD || seedPassword || 'campusway-demo';

  return {
    plugins: [react()],
    define: {
      __DEMO_PASSWORD__: JSON.stringify(demoPassword),
    },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      host: true,
      port: 5174,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        '/socket.io': { target: apiTarget, ws: true },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      css: false,
    },
  };
});
