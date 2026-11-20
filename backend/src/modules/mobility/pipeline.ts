/** The 5-minute aggregation: heatmap (3 periods) → hotspots → correction proposals → recommendations. */
import type { PrismaClient } from '@prisma/client';
import { bus } from '../../lib/events.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getCampusGraph } from '../routing/graph.repository.js';
import { proposeCorrections } from './corrections.js';
import { PERIODS, recomputeHeatmap } from './heatmap.js';
import { recomputeHotspots } from './hotspots.js';
import { recomputeRecommendations } from './recommendations.js';

export type AggregationSummary = { computedAt: string; heatmapCells: Record<string, number>; hotspots: number; newCorrections: number; recommendations: number };

let running: Promise<AggregationSummary> | null = null;
export let lastAggregation: AggregationSummary | null = null;

export function runMobilityAggregation(now: Date, db: PrismaClient = prisma): Promise<AggregationSummary> {
  // Single flight: overlapping cron ticks share the run in progress.
  running ??= (async () => {
    const heatmapCells: Record<string, number> = {};
    for (const period of PERIODS) heatmapCells[period] = await recomputeHeatmap(db, period, now);
    const graph = await getCampusGraph();
    const hotspots = await recomputeHotspots(graph, now);
    const newCorrections = await proposeCorrections(hotspots, graph, now);
    const recommendations = await recomputeRecommendations(hotspots, graph, now);
    const summary = { computedAt: now.toISOString(), heatmapCells, hotspots: hotspots.length, newCorrections, recommendations };
    lastAggregation = summary;
    bus.emit('mobility.aggregated', summary);
    logger.info(summary, 'mobility aggregation done');
    return summary;
  })().finally(() => {
    running = null;
  });
  return running;
}
