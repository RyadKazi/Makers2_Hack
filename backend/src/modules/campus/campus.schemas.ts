import { z } from 'zod';
import { LangSchema } from '../../lib/i18n.js';
import { IdParam } from '../../openapi/schemas.js';
import { RoomStatusSchema, RoomTypeSchema } from '../rooms/rooms.schemas.js';

export const LAYER_TYPES = ['rooms', 'walls', 'passages', 'entrances', 'elevators', 'stairs', 'ramps', 'toilets', 'accessible_toilets', 'facilities'] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

/** POI layers → POI types stored in the database. */
export const POI_LAYERS = {
  entrances: ['ENTRANCE', 'ACCESSIBLE_ENTRANCE'],
  elevators: ['ELEVATOR'],
  stairs: ['STAIRS'],
  ramps: ['RAMP'],
  toilets: ['TOILET'],
  accessible_toilets: ['ACCESSIBLE_TOILET'],
  facilities: ['FACILITY', 'INFO_DESK', 'PARKING_ACCESSIBLE'],
} as const satisfies Partial<Record<LayerType, readonly string[]>>;
export type PoiLayer = keyof typeof POI_LAYERS;

/** GeoJSON geometry in local campus metres: coordinates are [x, y]. */
export const GeometrySchema = z
  .object({
    type: z.enum(['Point', 'LineString', 'Polygon', 'MultiPolygon', 'MultiLineString']),
    coordinates: z.array(z.unknown()),
  })
  .meta({ id: 'Geometry', description: 'GeoJSON geometry, local campus metres [x, y]. With Leaflet CRS.Simple use L.geoJSON directly.' });

/** [minX, minY, maxX, maxY] in metres. */
export const BoundsSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).meta({ id: 'Bounds' });

const feature = <P extends z.ZodType>(id: string, properties: P) =>
  z
    .object({ type: z.literal('Feature'), id: z.string(), geometry: GeometrySchema.nullable(), properties })
    .meta({ id });

const collection = <F extends z.ZodType>(id: string, featureSchema: F) =>
  z.object({ type: z.literal('FeatureCollection'), features: z.array(featureSchema) }).meta({ id });

export const RoomFeatureSchema = feature(
  'RoomFeature',
  z.object({
    layer: z.literal('rooms'),
    code: z.string(),
    name: z.string(),
    nameAr: z.string().nullable(),
    type: RoomTypeSchema,
    capacity: z.number().int(),
    wheelchairSpaces: z.number().int(),
    hearingLoop: z.boolean(),
    status: RoomStatusSchema,
  }),
);

export const PoiFeatureSchema = feature(
  'PoiFeature',
  z.object({
    layer: z.enum(['entrances', 'elevators', 'stairs', 'ramps', 'toilets', 'accessible_toilets', 'facilities']),
    type: z.string(),
    name: z.string(),
    nameAr: z.string().nullable(),
    accessible: z.boolean(),
    notes: z.string().nullable(),
    level: z.number().int(),
    navNodeId: z.string().nullable(),
  }),
);

export const WallFeatureSchema = feature(
  'WallFeature',
  z.object({
    layer: z.literal('walls'),
    kind: z.enum(['WALL', 'GLASS', 'RAILING', 'CURB', 'GRASS_EDGE']),
    label: z.string().nullable(),
  }),
);

export const PassageFeatureSchema = feature(
  'PassageFeature',
  z.object({
    layer: z.literal('passages'),
    isOpen: z.boolean(),
    closedReason: z.string().nullable(),
    hasStairs: z.boolean(),
    stepCount: z.number().int(),
    isRamp: z.boolean(),
    slopePercent: z.number(),
    widthCm: z.number().int(),
    doorClearanceCm: z.number().int().nullable(),
    surface: z.string(),
    verified: z.boolean(),
  }),
);

export const RoomCollectionSchema = collection('RoomCollection', RoomFeatureSchema);
export const PoiCollectionSchema = collection('PoiCollection', PoiFeatureSchema);
export const WallCollectionSchema = collection('WallCollection', WallFeatureSchema);
export const PassageCollectionSchema = collection('PassageCollection', PassageFeatureSchema);

export const LayersSchema = z
  .object({
    rooms: RoomCollectionSchema.optional(),
    walls: WallCollectionSchema.optional(),
    passages: PassageCollectionSchema.optional().describe('Walkable segments on this level; closed ones have isOpen=false'),
    entrances: PoiCollectionSchema.optional(),
    elevators: PoiCollectionSchema.optional(),
    stairs: PoiCollectionSchema.optional(),
    ramps: PoiCollectionSchema.optional(),
    toilets: PoiCollectionSchema.optional(),
    accessible_toilets: PoiCollectionSchema.optional(),
    facilities: PoiCollectionSchema.optional(),
  })
  .meta({ id: 'Layers' });

const BuildingRef = z.object({ id: z.string(), code: z.string(), name: z.string(), nameAr: z.string() });
const FloorItem = z.object({ id: z.string(), level: z.number().int(), name: z.string(), elevationM: z.number(), roomCount: z.number().int() }).meta({ id: 'FloorItem' });

export const BuildingSchema = BuildingRef.extend({
  x: z.number().describe('Label anchor'),
  y: z.number(),
  footprint: GeometrySchema.nullable(),
  floors: z.array(FloorItem),
}).meta({ id: 'Building' });

export const BuildingListSchema = z.object({ items: z.array(BuildingSchema) }).meta({ id: 'BuildingList' });

export const BuildingFloorsSchema = z.object({ building: BuildingRef, items: z.array(FloorItem) }).meta({ id: 'BuildingFloors' });

export const CampusOverviewSchema = z
  .object({
    campus: z.object({ id: z.string(), name: z.string(), nameAr: z.string(), timezone: z.string() }),
    bounds: BoundsSchema,
    geofence: GeometrySchema.nullable().describe('Mobility data is only collected inside it'),
    buildings: z.array(BuildingSchema),
    outdoor: z.object({
      entrances: PoiCollectionSchema,
      ramps: PoiCollectionSchema,
      facilities: PoiCollectionSchema,
      walls: WallCollectionSchema,
      passages: PassageCollectionSchema,
    }),
  })
  .meta({ id: 'CampusOverview' });

export const FloorPlanSchema = z
  .object({
    floor: z.object({ id: z.string(), level: z.number().int(), name: z.string(), elevationM: z.number(), building: BuildingRef }),
    bounds: BoundsSchema,
    outline: GeometrySchema.nullable(),
    layers: LayersSchema,
    at: z.iso.datetime().describe('Instant room statuses were computed for'),
  })
  .meta({ id: 'FloorPlan' });

export const FloorLayersSchema = z
  .object({ floorId: z.string(), layers: LayersSchema, at: z.iso.datetime() })
  .meta({ id: 'FloorLayers' });

export const IdParams = z.object({ id: IdParam });
export const BuildingParams = z.object({ id: IdParam.describe('Building id or code (A, B)') });

export const LayersQuery = z.object({
  types: z
    .string()
    .regex(new RegExp(`^(${LAYER_TYPES.join('|')})(,(${LAYER_TYPES.join('|')}))*$`), `Comma-separated list of: ${LAYER_TYPES.join(', ')}`)
    .transform((s) => [...new Set(s.split(','))] as LayerType[])
    .optional()
    .describe(`Default: all. One or more of ${LAYER_TYPES.join(', ')}`),
  lang: LangSchema.optional(),
});
