import { defineRouter } from '../../http/route.js';
import {
  CreateReservationBody,
  ListReservationsQuery,
  ReservationIdParams,
  ReservationListSchema,
  ReservationSchema,
  UpdateReservationBody,
} from './reservations.schemas.js';
import * as service from './reservations.service.js';

const api = defineRouter('/api/reservations', 'Reservations');

const RULES =
  'Intervals are half-open [startsAt, endsAt): back-to-back sessions are allowed, any overlap in the same room is a 409 ' +
  '`RESERVATION_CONFLICT` listing the conflicting reservations in `error.details.conflicts`. Duration 15 min – 12 h.';

api.route(
  {
    method: 'get',
    path: '/',
    summary: 'List reservations in a time range',
    auth: 'required',
    request: { query: ListReservationsQuery },
    response: ReservationListSchema,
  },
  ({ query, user }) => service.listReservations(query, user, new Date()),
);

api.route(
  {
    method: 'get',
    path: '/:id',
    summary: 'Get a reservation',
    auth: 'required',
    request: { params: ReservationIdParams },
    response: ReservationSchema,
    errors: [404],
  },
  ({ params }) => service.getReservation(params.id),
);

api.route(
  {
    method: 'post',
    path: '/',
    summary: 'Reserve a room',
    description: `${RULES}\n\nTeachers create TEACHER (under their own name) or CLUB reservations; only admins create ADMIN ones.`,
    auth: 'required',
    roles: ['TEACHER', 'ADMIN', 'CLUB'],
    request: { body: CreateReservationBody },
    status: 201,
    response: ReservationSchema,
    errors: [404, 409],
  },
  ({ body, user }) => service.createReservation(body, user, new Date()),
);

api.route(
  {
    method: 'patch',
    path: '/:id',
    summary: 'Change a reservation',
    description: `${RULES}\n\nTeachers can change only their own reservations; admins any. Ended reservations are read-only.`,
    auth: 'required',
    roles: ['TEACHER', 'ADMIN', 'CLUB'],
    request: { params: ReservationIdParams, body: UpdateReservationBody },
    response: ReservationSchema,
    errors: [404, 409],
  },
  ({ params, body, user }) => service.updateReservation(params.id, body, user, new Date()),
);

api.route(
  {
    method: 'delete',
    path: '/:id',
    summary: 'Cancel a reservation',
    description: 'Teachers can cancel only their own upcoming or running reservations; admins any.',
    auth: 'required',
    roles: ['TEACHER', 'ADMIN', 'CLUB'],
    request: { params: ReservationIdParams },
    errors: [404, 409],
  },
  ({ params, user }) => service.deleteReservation(params.id, user, new Date()),
);

export const reservationsRouter = api.router;
