import type { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import type { Lang } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { statusesByRoom } from '../rooms/rooms.service.js';
import { toRoomStatusDto } from '../rooms/status.js';
import * as repo from './campus.repository.js';
import {
  LAYER_TYPES,
  POI_LAYERS,
  type BuildingFloorsSchema,
  type BuildingListSchema,
  type CampusOverviewSchema,
  type FloorPlanSchema,
  type LayersSchema,
  type LayerType,
  type PoiLayer,
} from './campus.schemas.js';

type LayersDto = z.input<typeof LayersSchema>;
type Bounds = [number, number, number, number];

const PADDING_M = 5;

const collection = <T>(features: T[]) => ({ type: 'FeatureCollection' as const, features });

function poiFeatures(rows: repo.PoiRow[], layer: PoiLayer) {
  const types: readonly string[] = POI_LAYERS[layer];
  return collection(
    rows
      .filter((p) => types.includes(p.type))
      .map((p) => ({
        type: 'Feature' as const,
        id: p.id,
        geometry: p.geometry,
        properties: { layer, type: p.type, name: p.name, nameAr: p.nameAr, accessible: p.accessible, notes: p.notes, level: p.level, navNodeId: p.navNodeId },
      })),
  );
}

const wallFeatures = (rows: repo.WallRow[]) =>
  collection(rows.map((w) => ({ type: 'Feature' as const, id: w.id, geometry: w.geometry, properties: { layer: 'walls' as const, kind: w.kind, label: w.label } })));

const passageFeatures = (rows: repo.PassageRow[]) =>
  collection(
    rows.map(({ id, geometry, ...props }) => ({ type: 'Feature' as const, id, geometry, properties: { layer: 'passages' as const, ...props } })),
  );

/** Builds the requested GeoJSON layers for one floor. */
async function floorLayers(floorId: string, types: readonly LayerType[], now: Date, lang: Lang): Promise<LayersDto> {
  const wanted = new Set(types);
  const poiLayers = (Object.keys(POI_LAYERS) as PoiLayer[]).filter((l) => wanted.has(l));
  const poiTypes = poiLayers.flatMap((l) => POI_LAYERS[l]);

  const [rooms, poiRows, wallRows, passageRows] = await Promise.all([
    wanted.has('rooms') ? repo.roomShapes(floorId) : Promise.resolve([]),
    repo.pois(floorId, poiTypes),
    wanted.has('walls') ? repo.walls(floorId) : Promise.resolve([]),
    wanted.has('passages') ? repo.passages(floorId) : Promise.resolve([]),
  ]);

  const layers: LayersDto = {};
  if (wanted.has('rooms')) {
    const statuses = await statusesByRoom(
      rooms.map((r) => r.id),
      now,
    );
    layers.rooms = collection(
      rooms.map(({ id, geometry, ...props }) => ({
        type: 'Feature' as const,
        id,
        geometry,
        properties: { layer: 'rooms' as const, ...props, status: toRoomStatusDto(statuses.get(id)!, lang) },
      })),
    );
  }
  if (wanted.has('walls')) layers.walls = wallFeatures(wallRows);
  if (wanted.has('passages')) layers.passages = passageFeatures(passageRows);
  for (const layer of poiLayers) layers[layer] = poiFeatures(poiRows, layer);
  return layers;
}

async function findFloor(id: string) {
  const floor = await prisma.floor.findUnique({ where: { id }, include: { building: true } });
  if (!floor) throw HttpError.notFound(`Floor ${id} not found`);
  return floor;
}

const buildingRef = (b: { id: string; code: string; name: string; nameAr: string }) => ({ id: b.id, code: b.code, name: b.name, nameAr: b.nameAr });

async function buildingsWithFloors() {
  const [buildings, footprints] = await Promise.all([
    prisma.building.findMany({
      orderBy: { code: 'asc' },
      include: { floors: { orderBy: { level: 'asc' }, include: { _count: { select: { rooms: true } } } } },
    }),
    repo.buildingFootprints(),
  ]);
  return buildings.map((b) => ({
    ...buildingRef(b),
    x: b.x,
    y: b.y,
    footprint: footprints.get(b.id) ?? null,
    floors: b.floors.map((f) => ({ id: f.id, level: f.level, name: f.name, elevationM: f.elevationM, roomCount: f._count.rooms })),
  }));
}

export async function listBuildings(): Promise<z.input<typeof BuildingListSchema>> {
  return { items: await buildingsWithFloors() };
}

export async function listBuildingFloors(idOrCode: string): Promise<z.input<typeof BuildingFloorsSchema>> {
  const building = await prisma.building.findFirst({
    where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
    include: { floors: { orderBy: { level: 'asc' }, include: { _count: { select: { rooms: true } } } } },
  });
  if (!building) throw HttpError.notFound(`Building ${idOrCode} not found`);
  return {
    building: buildingRef(building),
    items: building.floors.map((f) => ({ id: f.id, level: f.level, name: f.name, elevationM: f.elevationM, roomCount: f._count.rooms })),
  };
}

export async function getFloorPlan(id: string, now: Date, lang: Lang): Promise<z.input<typeof FloorPlanSchema>> {
  const floor = await findFloor(id);
  const [outline, layers] = await Promise.all([repo.floorOutline(id), floorLayers(id, LAYER_TYPES, now, lang)]);
  const bounds: Bounds =
    outline.minX !== null && outline.minY !== null && outline.maxX !== null && outline.maxY !== null
      ? [outline.minX - PADDING_M, outline.minY - PADDING_M, outline.maxX + PADDING_M, outline.maxY + PADDING_M]
      : [0, 0, 0, 0];
  return {
    floor: { id: floor.id, level: floor.level, name: floor.name, elevationM: floor.elevationM, building: buildingRef(floor.building) },
    bounds,
    outline: outline.geometry,
    layers,
    at: now.toISOString(),
  };
}

export async function getFloorLayers(id: string, types: readonly LayerType[] | undefined, now: Date, lang: Lang) {
  await findFloor(id);
  return { floorId: id, layers: await floorLayers(id, types ?? LAYER_TYPES, now, lang), at: now.toISOString() };
}

export async function getCampusOverview(): Promise<z.input<typeof CampusOverviewSchema>> {
  const row = await repo.campus();
  if (!row) throw HttpError.notFound('No campus configured. Run the seed.');
  const outdoorPoiTypes = [...POI_LAYERS.entrances, ...POI_LAYERS.ramps, ...POI_LAYERS.facilities];
  const [buildings, poiRows, wallRows, passageRows] = await Promise.all([
    buildingsWithFloors(),
    repo.pois(null, outdoorPoiTypes),
    repo.walls(null),
    repo.passages(null),
  ]);
  return {
    campus: { id: row.id, name: row.name, nameAr: row.nameAr, timezone: row.timezone },
    bounds: [row.minX ?? 0, row.minY ?? 0, row.maxX ?? 0, row.maxY ?? 0],
    geofence: row.geofence,
    buildings,
    outdoor: {
      entrances: poiFeatures(poiRows, 'entrances'),
      ramps: poiFeatures(poiRows, 'ramps'),
      facilities: poiFeatures(poiRows, 'facilities'),
      walls: wallFeatures(wallRows),
      passages: passageFeatures(passageRows),
    },
  };
}
