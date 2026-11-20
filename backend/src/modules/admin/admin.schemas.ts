import { z } from 'zod';
import { LangSchema } from '../../lib/i18n.js';
import { IdParam, IsoDateTime } from '../../openapi/schemas.js';

export const PeriodSchema = z.enum(['TODAY', '7D', '30D']).meta({ id: 'MobilityPeriod' });
export const SegmentSchema = z
  .enum(['ALL', 'DISABILITY', 'NONE', 'WHEELCHAIR', 'REDUCED_MOBILITY', 'BLIND_LOW_VISION', 'DEAF_HARD_OF_HEARING', 'SPEECH'])
  .meta({ id: 'MobilitySegment' });

export const HeatmapQuery = z.object({
  period: PeriodSchema.default('7D'),
  category: SegmentSchema.default('DISABILITY'),
  level: z.coerce.number().int().min(-5).max(50).optional(),
});

export const HeatmapSchema = z
  .object({
    period: PeriodSchema,
    category: SegmentSchema,
    windowStart: IsoDateTime.nullable(),
    windowEnd: IsoDateTime.nullable(),
    computedAt: IsoDateTime.nullable(),
    cellSizeM: z.number(),
    kMin: z.number().int().describe('Cells seen by fewer distinct people are never returned'),
    cells: z.array(
      z.object({
        level: z.number().int(),
        cellX: z.number().int(),
        cellY: z.number().int(),
        x: z.number().describe('Cell centre, campus metres'),
        y: z.number(),
        visits: z.number().int().describe('Distinct trips'),
        contributors: z.number().int().describe('Distinct daily pseudonyms (≥ kMin)'),
        difficulty: z.number().int(),
        stuck: z.number().int(),
      }),
    ),
  })
  .meta({ id: 'AdminHeatmap' });

export const HotspotsQuery = z.object({ level: z.coerce.number().int().min(-5).max(50).optional(), lang: LangSchema.optional() });

export const HotspotSchema = z
  .object({
    id: z.string(),
    level: z.number().int(),
    floorId: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    radiusM: z.number(),
    eventCount: z.number().int(),
    contributorCount: z.number().int(),
    dominantType: z.string(),
    byType: z.record(z.string(), z.number()),
    byCategory: z.record(z.string(), z.number()).describe('Distinct contributors per category; categories under kMin merged into OTHER'),
    edge: z.object({ id: z.string(), description: z.string(), hasStairs: z.boolean(), isRamp: z.boolean(), slopePercent: z.number(), widthCm: z.number(), isOpen: z.boolean() }).nullable(),
    shoreline: z
      .object({ wallId: z.string(), wallKind: z.string(), side: z.string().describe('Relative to the edge from → to'), distanceM: z.number() })
      .nullable()
      .describe('Nearest wall / curb / railing to follow'),
    computedAt: IsoDateTime,
  })
  .meta({ id: 'Hotspot' });

export const HotspotListSchema = z.object({ kMin: z.number().int(), items: z.array(HotspotSchema) }).meta({ id: 'HotspotList' });

const CorrectionStatus = z.enum(['PENDING', 'ACCEPTED', 'REJECTED']);
export const CorrectionsQuery = z.object({ status: CorrectionStatus.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export const CorrectionSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    source: z.enum(['CROWD', 'USER_REPORT', 'ADMIN']),
    status: CorrectionStatus,
    title: z.string(),
    description: z.string(),
    edgeId: z.string().nullable(),
    edgeDescription: z.string().nullable(),
    level: z.number().int(),
    x: z.number().nullable(),
    y: z.number().nullable(),
    proposed: z.record(z.string(), z.unknown()).nullable().describe('NavEdge changes applied on approval'),
    evidenceCount: z.number().int(),
    createdAt: IsoDateTime,
    reviewedAt: IsoDateTime.nullable(),
    reviewedBy: z.string().nullable(),
    reviewNote: z.string().nullable(),
  })
  .meta({ id: 'MapCorrection' });

export const CorrectionListSchema = z.object({ items: z.array(CorrectionSchema) }).meta({ id: 'MapCorrectionList' });

/** NavEdge fields a correction may change. */
export const EdgePatchSchema = z
  .object({
    isOpen: z.boolean(),
    closedReason: z.string().max(200).nullable(),
    slopePercent: z.number().min(0).max(40),
    widthCm: z.number().int().min(30).max(1000),
    doorClearanceCm: z.number().int().min(30).max(500).nullable(),
    surface: z.enum(['TILE', 'CONCRETE', 'ASPHALT', 'PAVERS', 'GRAVEL', 'CARPET', 'METAL']),
    verified: z.boolean(),
    hasStairs: z.boolean(),
    stepCount: z.number().int().min(0).max(200),
    isRamp: z.boolean(),
    wallSide: z.enum(['LEFT', 'RIGHT', 'BOTH', 'NONE']),
    wallDistanceM: z.number().min(0).max(50).nullable(),
    shorelineHint: z.string().max(200).nullable(),
  })
  .partial()
  .strict()
  .meta({ id: 'EdgePatch' });

export const ApproveBody = z
  .object({
    apply: EdgePatchSchema.optional().describe('Overrides on top of the proposed changes (e.g. the measured slope)'),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const RejectBody = z.object({ note: z.string().trim().min(3).max(500) }).strict();

export const ReviewResultSchema = z
  .object({ correction: CorrectionSchema, applied: z.record(z.string(), z.unknown()).nullable().describe('Changes written to the passage') })
  .meta({ id: 'MapCorrectionReview' });

export const RecommendationsQuery = z.object({ status: z.enum(['OPEN', 'PLANNED', 'DONE', 'DISMISSED']).optional(), lang: LangSchema.optional() });

export const RecommendationSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['RAMP', 'ELEVATOR', 'WIDEN_DOOR', 'ACCESSIBLE_ENTRANCE', 'SIGNAGE']),
    status: z.enum(['OPEN', 'PLANNED', 'DONE', 'DISMISSED']),
    title: z.string(),
    rationale: z.string(),
    score: z.number().describe('0–100'),
    evidence: z.record(z.string(), z.unknown()).describe('Aggregates behind the score (no personal data)'),
    level: z.number().int(),
    x: z.number(),
    y: z.number(),
    edgeId: z.string().nullable(),
    updatedAt: IsoDateTime,
  })
  .meta({ id: 'Recommendation' });

export const RecommendationListSchema = z
  .object({ formula: z.string(), items: z.array(RecommendationSchema) })
  .meta({ id: 'RecommendationList' });

export const UpdateRecommendationBody = z.object({ status: z.enum(['OPEN', 'PLANNED', 'DONE', 'DISMISSED']), lang: LangSchema.optional() }).strict();

const MaybeCount = z.number().int().nullable().describe('null when fewer than kMin people (suppressed)');

export const StatsSchema = z
  .object({
    generatedAt: IsoDateTime,
    kMin: z.number().int(),
    retentionDays: z.number().int(),
    sessions: z.object({ active: MaybeCount, today: MaybeCount, last7d: MaybeCount }),
    contributors: z.object({ today: MaybeCount, last7d: MaybeCount }).describe('Distinct daily pseudonyms'),
    categories7d: z.array(z.object({ category: z.string(), sessions: z.number().int(), contributors: z.number().int() })),
    events7d: z.object({ reported: z.record(z.string(), z.number()), detected: z.record(z.string(), z.number()) }),
    rawData: z.object({ points: z.number().int(), oldestPointAt: IsoDateTime.nullable() }),
    queue: z.object({ pendingCorrections: z.number().int(), openRecommendations: z.number().int(), hotspots: z.number().int() }),
    lastAggregationAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'MobilityStats' });

export const IdParams = z.object({ id: IdParam });

// ───────── SVG Floor Plans ─────────

export const FloorSvgSchema = z
  .object({
    floorId: z.string(),
    buildingCode: z.string(),
    buildingName: z.string(),
    level: z.number().int(),
    floorName: z.string(),
    svgContent: z.string(),
    isCustom: z.boolean(),
    updatedAt: IsoDateTime,
  })
  .meta({ id: 'FloorSvg' });

export const UpdateFloorSvgBody = z
  .object({
    svgContent: z.string().min(20, 'SVG content must be at least 20 characters'),
  })
  .strict()
  .meta({ id: 'UpdateFloorSvg' });

export const FloorSvgListItemSchema = z.object({
  floorId: z.string(),
  buildingId: z.string(),
  buildingCode: z.string(),
  buildingName: z.string(),
  level: z.number().int(),
  floorName: z.string(),
  roomCount: z.number().int(),
  hasCustomSvg: z.boolean(),
  updatedAt: IsoDateTime.nullable(),
});

export const FloorSvgListSchema = z
  .object({
    items: z.array(FloorSvgListItemSchema),
  })
  .meta({ id: 'FloorSvgList' });

