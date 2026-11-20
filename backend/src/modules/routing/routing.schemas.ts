import { z } from 'zod';
import { LangSchema } from '../../lib/i18n.js';
import { IdParam } from '../../openapi/schemas.js';
import { CONSTRAINT_KEYS } from './constraints.js';

const Level = z.number().int().min(-5).max(50);

export const LocationSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('room'), id: IdParam.describe('Room id or code, e.g. "B-212"') }),
    z.object({ type: z.literal('poi'), id: IdParam }),
    z.object({ type: z.literal('node'), id: IdParam }),
    z.object({
      type: z.literal('point'),
      x: z.number().min(-50).max(1000),
      y: z.number().min(-50).max(1000),
      level: Level,
      floorId: IdParam.optional(),
    }),
  ])
  .meta({ id: 'RouteLocation', description: 'A room (its door), a point of interest, a graph node, or a position snapped to the nearest walkable node (≤ 40 m).' });

const ConstraintsInputSchema = z
  .object({
    useProfile: z.boolean().optional().describe('Start from the signed-in user’s accessibility profile (default true)'),
    avoidStairs: z.boolean().optional(),
    maxSlopePercent: z.number().min(0).max(30).nullable().optional(),
    minDoorWidthCm: z.number().int().min(40).max(300).nullable().optional(),
    verifiedRampsOnly: z.boolean().optional(),
    verifiedOnly: z.boolean().optional().describe('Only passages verified on site'),
    avoidEdgeIds: z.array(IdParam).max(50).optional(),
  })
  .strict()
  .meta({ id: 'RouteConstraintsInput', description: 'Overrides on top of the profile. Closed passages are always excluded.' });

export const OptionIdSchema = z.enum(['fastest', 'step-free']).meta({ id: 'RouteOptionId' });
export const TravelModeSchema = z.enum(['walking', 'wheelchair']).meta({ id: 'TravelMode' });

export const PlanRouteBody = z
  .object({
    from: LocationSchema,
    to: LocationSchema,
    constraints: ConstraintsInputSchema.optional(),
    mode: TravelModeSchema.optional().describe('Default: wheelchair for wheelchair profiles, walking otherwise'),
    options: z.array(OptionIdSchema).min(1).max(2).optional().describe('Default: both'),
    shorelineHints: z.boolean().optional().describe('Add wall-following sentences (default: profile setting)'),
    lang: LangSchema.optional(),
  })
  .strict()
  .meta({ id: 'PlanRouteRequest' });

const ConstraintKeySchema = z.enum(CONSTRAINT_KEYS).meta({ id: 'RouteConstraintKey' });

const EffectiveConstraintsSchema = z
  .object({
    closedPassages: z.boolean(),
    avoidStairs: z.boolean(),
    maxSlopePercent: z.number().nullable(),
    minDoorWidthCm: z.number().nullable(),
    verifiedRampsOnly: z.boolean(),
    verifiedOnly: z.boolean(),
    avoidEdgeIds: z.array(z.string()),
  })
  .meta({ id: 'EffectiveRouteConstraints' });

const ResolvedLocationSchema = z
  .object({
    type: z.enum(['room', 'poi', 'node', 'point']),
    nodeId: z.string(),
    name: z.string(),
    level: z.number().int(),
    floorId: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    snappedDistanceM: z.number().nullable(),
  })
  .meta({ id: 'ResolvedLocation' });

const ShorelineSchema = z
  .object({
    side: z.enum(['LEFT', 'RIGHT', 'BOTH']).describe('Relative to the walking direction'),
    feature: z.enum(['WALL', 'EDGE']),
    distanceM: z.number(),
    offsetM: z.number().nullable(),
    hint: z.string().nullable().describe('Original hint from the map data (French)'),
  })
  .meta({ id: 'Shoreline' });

export const StepSchema = z
  .object({
    index: z.number().int(),
    type: z.enum(['START', 'WALK', 'RAMP', 'STEPS', 'ELEVATOR', 'STAIRS', 'ENTER', 'EXIT', 'ARRIVE']),
    instruction: z.string(),
    distanceM: z.number(),
    turn: z.enum(['STRAIGHT', 'SLIGHT_LEFT', 'LEFT', 'SHARP_LEFT', 'SLIGHT_RIGHT', 'RIGHT', 'SHARP_RIGHT', 'U_TURN']).nullable(),
    fromNodeId: z.string(),
    toNodeId: z.string(),
    edgeIds: z.array(z.string()),
    level: z.number().int(),
    toLevel: z.number().int().nullable(),
    floorId: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    landmark: z.string().nullable(),
    shoreline: ShorelineSchema.nullable(),
  })
  .meta({ id: 'RouteStep' });

const FloorGeoJsonSchema = z
  .object({
    floorId: z.string().nullable().describe('null = outdoors'),
    level: z.number().int(),
    buildingCode: z.string().nullable(),
    featureCollection: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()) }),
  })
  .meta({ id: 'RouteFloorGeoJson', description: 'LineStrings per edge (kind, stepIndex), Points for start / end / floor transitions. Campus metres [x, y].' });

export const RouteOptionSchema = z
  .object({
    id: OptionIdSchema,
    label: z.string(),
    stepFree: z.boolean(),
    distanceM: z.number(),
    etaSec: z.number().int(),
    travelMode: TravelModeSchema,
    elevatorCount: z.number().int(),
    rampCount: z.number().int(),
    stairsCount: z.number().int(),
    levels: z.array(z.number().int()),
    constraints: EffectiveConstraintsSchema,
    prefilteredConstraints: z.array(z.string()).describe('Constraints the engine cannot apply natively, enforced by filtering edges first'),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })),
    nodeIds: z.array(z.string()),
    edgeIds: z.array(z.string()),
    steps: z.array(StepSchema),
    geojson: z.array(FloorGeoJsonSchema),
  })
  .meta({ id: 'RouteOption' });

export const UnavailableSchema = z
  .object({
    option: OptionIdSchema,
    reason: z.enum(['CONSTRAINT', 'COMBINATION', 'DISCONNECTED']),
    message: z.string(),
    blockers: z.array(
      z.object({
        constraint: ConstraintKeySchema,
        message: z.string(),
        edges: z.array(
          z.object({
            edgeId: z.string(),
            description: z.string(),
            value: z.union([z.number(), z.string()]).nullable(),
            limit: z.union([z.number(), z.string()]).nullable(),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'RouteUnavailable', description: 'Why an option has no route: which constraint blocks it, and where.' });

export const RoutePlanSchema = z
  .object({
    routeId: z.string().nullable().describe('Use with /recheck. null when no option was found.'),
    version: z.number().int(),
    engine: z.string().describe('Routing engine that computed the paths'),
    from: ResolvedLocationSchema,
    to: ResolvedLocationSchema,
    travelMode: TravelModeSchema,
    options: z.array(RouteOptionSchema).max(2),
    unavailable: z.array(UnavailableSchema),
  })
  .meta({ id: 'RoutePlan' });

export const RecheckBody = z
  .object({
    position: z
      .object({
        x: z.number().min(-50).max(1000),
        y: z.number().min(-50).max(1000),
        level: Level,
        floorId: IdParam.optional(),
        accuracyM: z.number().min(0).max(200).optional(),
      })
      .strict(),
    option: OptionIdSchema.optional().describe('Option being followed (default: the first one)'),
    lang: LangSchema.optional(),
  })
  .strict()
  .meta({ id: 'RecheckRouteRequest' });

export const RecheckSchema = z
  .object({
    routeId: z.string(),
    version: z.number().int().describe('Increments on every reroute'),
    option: OptionIdSchema,
    status: z.enum(['ON_ROUTE', 'ARRIVED', 'REROUTED', 'NO_ROUTE']),
    reason: z.enum(['OFF_ROUTE', 'EDGE_CLOSED', 'WRONG_FLOOR']).nullable(),
    message: z.string(),
    distanceFromRouteM: z.number().nullable(),
    progress: z.object({ completedM: z.number(), remainingM: z.number(), nextStepIndex: z.number().int().nullable() }).nullable(),
    blockedEdge: z.object({ edgeId: z.string(), description: z.string(), closedReason: z.string().nullable() }).nullable(),
    route: RouteOptionSchema.nullable().describe('The new route when REROUTED'),
    unavailable: UnavailableSchema.nullable(),
  })
  .meta({ id: 'RouteRecheck' });

export const RouteIdParams = z.object({ id: z.uuid() });
