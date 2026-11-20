import type { Router } from 'express';
import { defineRouter } from '../../http/route.js';
import { createAiRouteRateLimit } from '../../middleware/aiRateLimit.js';
import { calculateAiRoute, getAiHealth } from './ai.service.js';
import { AiHealthSchema, AiRouteRequestSchema, AiRouteResponseSchema } from './ai.schemas.js';

const api = defineRouter('/api/ai', 'AI navigation');

// Separate per-IP budget: this endpoint fans out to Python + PostgreSQL.
api.router.use('/route', createAiRouteRateLimit());

api.route(
  {
    method: 'get',
    path: '/health',
    summary: 'Check the Python navigation service through Node',
    description:
      'Node-side probe of the FastAPI `/api/v1/health` endpoint. Returns 502 when the Python service is unreachable.',
    response: AiHealthSchema,
    errors: [502],
  },
  () => getAiHealth(),
);

api.route(
  {
    method: 'post',
    path: '/route',
    summary: 'Calculate a route with the Python Dijkstra service',
    description:
      'Gateway to the FastAPI Dijkstra service. Node validates the request, adds the server-side API key, calls ' +
      '`/api/v1/navigation/route` (PostgreSQL graph), and returns a stable client response. Clients never need the ' +
      'Python base URL or API key. Unknown buildings/nodes return 404, invalid or unreachable requests return 422, ' +
      'and an unavailable/unauthorised upstream returns 502/503.',
    auth: 'optional',
    request: { body: AiRouteRequestSchema },
    response: AiRouteResponseSchema,
    errors: [404, 422, 429, 502, 503],
  },
  ({ body }) => calculateAiRoute(body),
);

export const aiRouter: Router = api.router;
