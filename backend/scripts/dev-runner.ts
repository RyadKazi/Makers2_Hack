import { startDevDb } from './dev-db.js';

async function bootstrap() {
  try {
    console.log('⚡ Initializing CampusWay local stack...');
    await startDevDb();
    console.log('🚀 Launching API server...\n');
    await import('../src/index.js');
  } catch (err) {
    console.error('Fatal error during startup:', err);
    process.exit(1);
  }
}

void bootstrap();
