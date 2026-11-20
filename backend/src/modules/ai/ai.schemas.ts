import { z } from 'zod';

const ProfileSchema = z.enum(['general', 'wheelchair', 'visual_impairment', 'blind_navigation']);

const AccessibilitySchema = z
  .object({
    accessible: z.boolean().nullable(),
    blocked: z.boolean(),
    verified: z.boolean(),
    door_width_m: z.number().nullable(),
    ramp_slope: z.number().nullable(),
    surface_condition: z.string().nullable(),
    landmarks: z.array(z.string()),
    additional: z.record(z.string(), z.unknown()),
  })
  .strict();

const NodeSchema = z
  .object({
    node_id: z.string(),
    building_id: z.string(),
    floor_id: z.string(),
    x: z.number(),
    y: z.number(),
    node_type: z.enum(['door', 'staircase', 'corridor_intersection', 'entrance', 'elevator', 'ramp', 'room_access', 'waypoint']),
    accessibility: AccessibilitySchema,
    staircase_connection_id: z.string().nullable(),
    is_destination: z.boolean(),
    label: z.string().nullable(),
  })
  .strict();

const EdgeSchema = z
  .object({
    source_node: z.string(),
    destination_node: z.string(),
    distance: z.number(),
    connection_type: z.enum(['corridor', 'doorway', 'stairs', 'elevator', 'ramp', 'entrance', 'other']),
    accessibility: AccessibilitySchema,
    bidirectional: z.boolean(),
  })
  .strict();

export const AiRouteRequestSchema = z
  .object({
    building_id: z.string().min(1),
    start_node: z.string().min(1),
    destination_node: z.string().min(1),
    profile: ProfileSchema.default('general'),
    constraints: z
      .object({
        minimum_door_width_m: z.number().positive().nullable().optional(),
        maximum_ramp_slope: z.number().min(0).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .meta({ id: 'AiRouteRequest' });

const FloorTransitionSchema = z
  .object({
    from_floor: z.number().int(),
    to_floor: z.number().int(),
    from_floor_id: z.string(),
    to_floor_id: z.string(),
    type: z.string(),
  })
  .strict();

export const AiRouteResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
    route: z
      .object({
        nodes: z.array(z.string()),
        total_distance: z.number().nonnegative(),
        floor_transitions: z.array(FloorTransitionSchema),
        profile: ProfileSchema,
        node_details: z.array(NodeSchema),
        edges: z.array(EdgeSchema),
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'AiRouteResponse' });

/** Envelope returned by FastAPI `/api/v1/navigation/route` (PostgreSQL graph). */
export const AiRouteV1EnvelopeSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
    data: z
      .object({
        building_id: z.string(),
        route: z.array(z.string()),
        nodes: z.array(NodeSchema),
        edges: z.array(EdgeSchema),
        total_distance: z.number().nonnegative(),
        floor_transitions: z.array(FloorTransitionSchema),
      })
      .strict(),
  })
  .strict();

export const AiHealthSchema = z
  .object({
    reachable: z.literal(true),
    status: z.string(),
    version: z.string(),
  })
  .strict()
  .meta({ id: 'AiHealth' });

export const AiV1HealthEnvelopeSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
    data: z.object({ status: z.string(), version: z.string() }).strict(),
  })
  .strict();

export type AiRouteRequest = z.infer<typeof AiRouteRequestSchema>;
