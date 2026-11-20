/**
 * Mobility background jobs:
 *   every minute     auto-stop sessions (3 h / midnight), then run the detectors (STUCK, U-turns)
 *   every 5 minutes  aggregation: heatmap, hotspots, correction proposals, recommendations
 *   every hour       retention purge (raw data and salts older than 30 days)
 */
import { schedule, type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger.js';
import { runDetectors } from '../modules/mobility/analysis.js';
import { runMobilityAggregation } from '../modules/mobility/pipeline.js';
import { purgeExpiredRawData } from '../modules/mobility/retention.js';
import { autoStopDueSessions } from '../modules/mobility/sessions.service.js';

const safely = (name: string, job: () => Promise<unknown>) => async () => {
  try {
    await job();
  } catch (err) {
    logger.error({ err, job: name }, 'mobility job failed');
  }
};

export function startMobilityJobs(): { stop: () => Promise<void> } {
  const tasks: ScheduledTask[] = [
    schedule(
      '5 * * * * *',
      safely('sessions+detectors', async () => {
        const now = new Date();
        await autoStopDueSessions(now);
        await runDetectors(now);
      }),
      { name: 'mobility-minute', noOverlap: true },
    ),
    schedule('20 */5 * * * *', safely('aggregation', () => runMobilityAggregation(new Date())), { name: 'mobility-aggregation', noOverlap: true }),
    schedule('40 7 * * * *', safely('retention', () => purgeExpiredRawData(new Date())), { name: 'mobility-retention', noOverlap: true }),
  ];
  // Run retention and a first aggregation shortly after boot.
  const boot = setTimeout(() => {
    void safely('retention', () => purgeExpiredRawData(new Date()))();
    void safely('aggregation', () => runMobilityAggregation(new Date()))();
  }, 5_000);
  return {
    stop: async () => {
      clearTimeout(boot);
      await Promise.all(tasks.map((t) => t.stop()));
    },
  };
}
