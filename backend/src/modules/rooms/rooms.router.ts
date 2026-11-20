import { defineRouter } from '../../http/route.js';
import { LangQuery, ListRoomsQuery, RoomDetailSchema, RoomListSchema, RoomParams } from './rooms.schemas.js';
import { getRoom, listRooms } from './rooms.service.js';

const api = defineRouter('/api/rooms', 'Rooms');

api.route(
  {
    method: 'get',
    path: '/',
    summary: 'Search rooms with their live status',
    description: 'Status is computed from reservations at request time. Filters combine with AND.',
    request: { query: ListRoomsQuery },
    response: RoomListSchema,
  },
  ({ query, lang }) => listRooms(query, new Date(), query.lang ?? lang),
);

api.route(
  {
    method: 'get',
    path: '/:id',
    summary: 'Room details',
    description: "Live status, today's schedule, accessibility info and the nearest elevator / accessible toilet (step-free walking distance).",
    request: { params: RoomParams, query: LangQuery },
    response: RoomDetailSchema,
    errors: [404],
  },
  ({ params, query, lang }) => getRoom(params.id, new Date(), query.lang ?? lang),
);

export const roomsRouter = api.router;
