import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';

const app = createApp({ checkDatabase: async () => true });
const routeRequest = {
  building_id: 'BUILDING_A',
  start_node: 'ENTRANCE',
  destination_node: 'ROOM_1',
};

const node = {
  node_id: 'ENTRANCE',
  building_id: 'BUILDING_A',
  floor_id: 'G',
  x: 1,
  y: 2,
  node_type: 'waypoint',
  accessibility: {
    accessible: null,
    blocked: false,
    verified: false,
    door_width_m: null,
    ramp_slope: null,
    surface_condition: null,
    landmarks: [],
    additional: {},
  },
  staircase_connection_id: null,
  is_destination: false,
  label: null,
};

const routeData = {
  building_id: 'BUILDING_A',
  route: ['ENTRANCE'],
  nodes: [node],
  edges: [],
  total_distance: 0,
  floor_transitions: [],
};

const v1Response = {
  success: true,
  message: 'Route successfully calculated',
  data: routeData,
};

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/ai/route', () => {
  it('calls the v1 PostgreSQL route with the server-side key and adapts the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(v1Response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app).post('/api/ai/route').send(routeRequest);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/navigation\/route$/),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: `Bearer ${env.ACCESU_NAVIGATION_API_KEY}` }),
        body: JSON.stringify({ ...routeRequest, profile: 'general' }),
      }),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Route successfully calculated',
      route: {
        nodes: ['ENTRANCE'],
        total_distance: 0,
        floor_transitions: [],
        profile: 'general',
        node_details: [node],
        edges: [],
      },
    });
  });

  it('preserves Python missing-building errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, message: 'Building not found', data: null }), { status: 404 }),
      ),
    );

    const response = await request(app).post('/api/ai/route').send(routeRequest);

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'AI_ROUTE_NOT_FOUND', message: 'Building not found' });
  });

  it('treats a rejected API key as a server configuration error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, message: 'Invalid API key', data: null }), { status: 401 }),
      ),
    );

    const response = await request(app).post('/api/ai/route').send(routeRequest);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_SERVICE_AUTH_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('Invalid API key');
  });

  it('returns a gateway error when Python cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await request(app).post('/api/ai/route').send(routeRequest);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('rejects unknown request fields before calling Python', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app).post('/api/ai/route').send({ ...routeRequest, debug: true });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the server-side API key is missing', async () => {
    const saved = env.ACCESU_NAVIGATION_API_KEY;
    env.ACCESU_NAVIGATION_API_KEY = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await request(app).post('/api/ai/route').send(routeRequest);
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('AI_SERVICE_NOT_CONFIGURED');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      env.ACCESU_NAVIGATION_API_KEY = saved;
    }
  });
});

describe('GET /api/ai/health', () => {
  it('reports the Python service status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { status: 'healthy', version: 'v1' }, message: 'ok' }),
          { status: 200 },
        ),
      ),
    );

    const response = await request(app).get('/api/ai/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reachable: true, status: 'healthy', version: 'v1' });
  });

  it('returns 502 when the Python service is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await request(app).get('/api/ai/health');

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });
});
