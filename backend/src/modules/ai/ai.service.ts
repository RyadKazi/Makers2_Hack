/**
 * Server-side gateway to the FastAPI Dijkstra service.
 *
 * Clients only know this API: the Python URL and its privileged API key stay on
 * the Node server. Python reads the graph from PostgreSQL through `/api/v1`.
 */
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  AiRouteResponseSchema,
  AiRouteV1EnvelopeSchema,
  AiV1HealthEnvelopeSchema,
  type AiRouteRequest,
} from './ai.schemas.js';

const ROUTE_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 3_000;

function navigationUrl(path: string): string {
  return `${env.ACCESU_NAVIGATION_URL.replace(/\/+$/, '')}${path}`;
}

function requireApiKey(): string {
  if (!env.ACCESU_NAVIGATION_API_KEY) {
    throw new HttpError(
      503,
      'AI_SERVICE_NOT_CONFIGURED',
      'Navigation service is not configured: set ACCESU_NAVIGATION_API_KEY',
    );
  }
  return env.ACCESU_NAVIGATION_API_KEY;
}

async function upstreamFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(navigationUrl(path), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    logger.warn({ err, path }, 'navigation service request failed');
    throw new HttpError(502, 'AI_SERVICE_UNAVAILABLE', 'Navigation service could not be reached');
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    logger.warn({ status: response.status }, 'navigation service returned invalid JSON');
    throw new HttpError(502, 'AI_SERVICE_INVALID_RESPONSE', 'Navigation service returned an invalid response');
  }
}

function upstreamError(response: Response, payload: unknown): HttpError {
  const message =
    typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'Navigation service rejected the request';

  if (response.status === 404) return new HttpError(404, 'AI_ROUTE_NOT_FOUND', message);
  if (response.status === 422) return new HttpError(422, 'AI_ROUTE_INVALID', message);
  // A bad key is a server-side configuration problem, not a client error.
  if (response.status === 401 || response.status === 403) {
    return new HttpError(502, 'AI_SERVICE_AUTH_FAILED', 'Navigation service rejected its API key');
  }
  if (response.status === 503) return new HttpError(503, 'AI_SERVICE_UNAVAILABLE', message);
  logger.warn({ status: response.status }, 'navigation service returned an error');
  return new HttpError(502, 'AI_SERVICE_ERROR', 'Navigation service failed');
}

export async function calculateAiRoute(input: AiRouteRequest) {
  const apiKey = requireApiKey();
  const response = await upstreamFetch(
    '/api/v1/navigation/route',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(input),
    },
    ROUTE_TIMEOUT_MS,
  );
  const payload = await readJson(response);
  if (!response.ok) throw upstreamError(response, payload);

  const parsed = AiRouteV1EnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues.slice(0, 5) }, 'Python route response did not match the v1 contract');
    throw new HttpError(502, 'AI_SERVICE_INVALID_RESPONSE', 'Navigation service returned an invalid response');
  }

  // Keep the client contract stable: Python v1 nests the route under `data`.
  const result = AiRouteResponseSchema.safeParse({
    success: true,
    message: parsed.data.message,
    route: {
      nodes: parsed.data.data.route,
      total_distance: parsed.data.data.total_distance,
      floor_transitions: parsed.data.data.floor_transitions,
      profile: input.profile,
      node_details: parsed.data.data.nodes,
      edges: parsed.data.data.edges,
    },
  });
  if (!result.success) {
    logger.warn({ issues: result.error.issues.slice(0, 5) }, 'Python route could not be adapted to the client contract');
    throw new HttpError(502, 'AI_SERVICE_INVALID_RESPONSE', 'Navigation service returned an invalid response');
  }
  return result.data;
}

export async function getAiHealth() {
  const response = await upstreamFetch('/api/v1/health', { method: 'GET' }, HEALTH_TIMEOUT_MS);
  const payload = await readJson(response);
  if (!response.ok) throw upstreamError(response, payload);

  const parsed = AiV1HealthEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues.slice(0, 5) }, 'Python health response did not match its contract');
    throw new HttpError(502, 'AI_SERVICE_INVALID_RESPONSE', 'Navigation service returned an invalid response');
  }
  return { reachable: true as const, status: parsed.data.data.status, version: parsed.data.data.version };
}
