import { defineRouter } from '../../http/route.js';
import { LangQuery } from '../rooms/rooms.schemas.js';
import {
  BuildingFloorsSchema,
  BuildingListSchema,
  BuildingParams,
  CampusOverviewSchema,
  FloorLayersSchema,
  FloorPlanSchema,
  IdParams,
  LayersQuery,
} from './campus.schemas.js';
import * as campus from './campus.service.js';
import { buildSearchIndex, SearchIndexSchema } from './searchIndex.js';

const api = defineRouter('/api/campus', 'Campus');

api.route(
  {
    method: 'get',
    path: '/',
    summary: 'Campus overview',
    description: 'Bounds, geofence, building footprints and outdoor layers (entrances, ramps, facilities, curbs, paths).',
    response: CampusOverviewSchema,
    errors: [404],
  },
  () => campus.getCampusOverview(),
);

api.route({ method: 'get', path: '/buildings', summary: 'Buildings with footprints and floors', response: BuildingListSchema }, () =>
  campus.listBuildings(),
);

api.route(
  {
    method: 'get',
    path: '/buildings/:id/floors',
    summary: 'Floors of a building',
    request: { params: BuildingParams },
    response: BuildingFloorsSchema,
    errors: [404],
  },
  ({ params }) => campus.listBuildingFloors(params.id),
);

api.route(
  {
    method: 'get',
    path: '/floors/:id',
    summary: 'Floor plan',
    description: 'Plan metadata (bounds, outline) and every GeoJSON layer: rooms with live status, POIs, walls and passages.',
    request: { params: IdParams, query: LangQuery },
    response: FloorPlanSchema,
    errors: [404],
  },
  ({ params, query, lang }) => campus.getFloorPlan(params.id, new Date(), query.lang ?? lang),
);

api.route(
  {
    method: 'get',
    path: '/floors/:id/layers',
    summary: 'Selected layers of a floor',
    description: 'e.g. `?types=rooms,elevators,accessible_toilets`',
    request: { params: IdParams, query: LayersQuery },
    response: FloorLayersSchema,
    errors: [404],
  },
  ({ params, query, lang }) => campus.getFloorLayers(params.id, query.types, new Date(), query.lang ?? lang),
);

api.route(
  {
    method: 'get',
    path: '/search-index',
    summary: 'Search index (rooms, buildings, POIs, clubs)',
    description: 'Small enough to load once; the client runs fuzzy matching in Arabic, French and English.',
    response: SearchIndexSchema,
  },
  () => buildSearchIndex(new Date()),
);

export const campusRouter = api.router;
