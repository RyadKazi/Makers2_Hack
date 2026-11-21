import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { startMobilityJobs } from './jobs/mobilityJobs.js';
import { startRoomStatusTicker } from './jobs/roomStatusTicker.js';
import { logger } from './lib/logger.js';
import { isDatabaseUp, prisma } from './lib/prisma.js';
import { warmCampusGraph } from './modules/routing/graph.repository.js';
import { createSocketServer } from './sockets/index.js';

const app = createApp({ checkDatabase: () => isDatabaseUp() });
const httpServer = createServer(app);
const sockets = createSocketServer(httpServer);
const ticker = startRoomStatusTicker();
const mobilityJobs = startMobilityJobs();

httpServer.listen(env.PORT, () => {
  logger.info(`accesU API listening on http://localhost:${env.PORT} (docs: /docs)`);
  void warmCampusGraph();
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await ticker.stop();
  await mobilityJobs.stop();
  await sockets.close();
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
