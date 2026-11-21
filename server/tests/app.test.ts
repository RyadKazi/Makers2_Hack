import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/lib/errors.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { validate } from '../src/middleware/validate.js';

describe('GET /health', () => {
  it('returns 200 and ok when the database is up', async () => {
    const app = createApp({ checkDatabase: async () => true });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'accesu-server', checks: { database: 'up' } });
  });

  it('returns 503 and degraded when the database is down', async () => {
    const app = createApp({ checkDatabase: async () => false });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe('down');
  });

  it('sets security headers (helmet)', async () => {
    const app = createApp({ checkDatabase: async () => true });
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('error handling', () => {
  const app = createApp({ checkDatabase: async () => true });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe('validate() middleware', () => {
  const testApp = express();
  testApp.use(express.json());
  testApp.post(
    '/rooms/:code',
    validate({
      params: z.object({ code: z.string().regex(/^[AB]-\d{3}$/) }),
      query: z.object({ at: z.coerce.number().int().optional() }),
      body: z.object({ title: z.string().min(3) }),
    }),
    (_req, res) => res.json(res.locals.validated),
  );
  testApp.get('/boom', () => {
    throw new HttpError(418, 'TEAPOT', 'short and stout');
  });
  testApp.get('/crash', () => {
    throw new Error('secret internals');
  });
  testApp.use(notFoundHandler);
  testApp.use(errorHandler);

  it('passes parsed and coerced values through', async () => {
    const res = await request(testApp).post('/rooms/A-104?at=1700').send({ title: 'Algorithmique' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { code: 'A-104' }, query: { at: 1700 }, body: { title: 'Algorithmique' } });
  });

  it('collects every issue across params, query and body', async () => {
    const res = await request(testApp).post('/rooms/Z-1?at=abc').send({ title: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const locations = res.body.error.details.map((d: { location: string }) => d.location).sort();
    expect(locations).toEqual(['body', 'params', 'query']);
  });

  it('maps HttpError to its status', async () => {
    const res = await request(testApp).get('/boom');
    expect(res.status).toBe(418);
    expect(res.body.error).toEqual({ code: 'TEAPOT', message: 'short and stout' });
  });

  it('hides internals on unexpected errors', async () => {
    const res = await request(testApp).get('/crash');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
  });
});

describe('OpenAPI', () => {
  const app = createApp({ checkDatabase: async () => true });

  it('serves an OpenAPI 3.1 document covering every API route', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const operations = Object.entries(res.body.paths as Record<string, Record<string, unknown>>).flatMap(([path, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`),
    );
    expect(operations).toEqual(
      expect.arrayContaining([
        'POST /api/auth/register',
        'POST /api/auth/login',
        'POST /api/auth/refresh',
        'GET /api/me',
        'PUT /api/me/accessibility-profile',
        'GET /api/campus/buildings',
        'GET /api/campus/buildings/{id}/floors',
        'GET /api/campus/floors/{id}',
        'GET /api/campus/floors/{id}/layers',
        'GET /api/rooms',
        'GET /api/rooms/{id}',
        'POST /api/reservations',
        'PATCH /api/reservations/{id}',
        'DELETE /api/reservations/{id}',
        'PATCH /api/admin/edges/{id}/status',
        'GET /health',
      ]),
    );
  });

  it('only references components that exist', async () => {
    const doc = (await request(app).get('/openapi.json')).body;
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(20);
    for (const name of new Set(refs)) expect(doc.components.schemas, name).toHaveProperty(name);
    expect(JSON.stringify(doc)).not.toContain('#/$defs/');
  });

  it('describes the shared DTOs and security', async () => {
    const doc = (await request(app).get('/openapi.json')).body;
    expect(doc.components.schemas.RoomStatus.properties.status.$ref).toBe('#/components/schemas/RoomStatusCode');
    expect(doc.components.schemas.RoomStatusCode.enum).toEqual(['AVAILABLE', 'TEACHER', 'ADMIN', 'CLUB']);
    expect(Object.keys(doc.components.schemas.RoomStatus.properties)).toEqual(
      expect.arrayContaining(['status', 'label', 'occupantName', 'until', 'freeAt']),
    );
    const create = doc.paths['/api/reservations'].post;
    expect(create.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(create.responses)).toEqual(expect.arrayContaining(['201', '400', '401', '403', '409']));
    const list = doc.paths['/api/rooms'].get;
    expect(list.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['search', 'status', 'buildingId', 'floor', 'minCapacity', 'stepFree']),
    );
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
