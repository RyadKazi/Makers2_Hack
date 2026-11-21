import { defineRouter } from '../../http/route.js';
import { PlanRouteBody, RecheckBody, RecheckSchema, RouteIdParams, RoutePlanSchema } from './routing.schemas.js';
import { planRoute, recheckRoute } from './routing.service.js';

const api = defineRouter('/api/routes', 'Routes');

api.route(
  {
    method: 'post',
    path: '/plan',
    summary: 'Plan an accessible route',
    description:
      'Returns up to two options: **fastest** (your constraints) and **step-free** (no stairs or steps), with distance, ETA ' +
      '(walking or wheelchair speed), elevator / ramp counts, GeoJSON per floor and turn-by-turn steps (AR/FR/EN, shoreline hints).\n\n' +
      'Signed-in users get their accessibility profile applied (disable with `constraints.useProfile: false`). ' +
      'When an option is impossible, `unavailable` explains which constraint blocks it and where.',
    auth: 'optional',
    request: { body: PlanRouteBody },
    response: RoutePlanSchema,
    errors: [404, 422],
  },
  ({ body, user, lang }) => planRoute(body, user, body.lang ?? lang),
);

api.route(
  {
    method: 'post',
    path: '/:id/recheck',
    summary: 'Check progress, detect deviation or closures, reroute',
    description:
      'Send the current position while navigating. Status: ON_ROUTE, ARRIVED, REROUTED (new route included, reason ' +
      'OFF_ROUTE / WRONG_FLOOR / EDGE_CLOSED) or NO_ROUTE (with explanation). Reroutes also emit `route:invalidated` on /live.',
    request: { params: RouteIdParams, body: RecheckBody },
    response: RecheckSchema,
    errors: [404, 422],
  },
  ({ params, body, lang }) => recheckRoute(params.id, body, body.lang ?? lang),
);

export const routingRouter = api.router;
