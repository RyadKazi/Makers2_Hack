import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAiRouteRateLimit } from '../src/middleware/aiRateLimit.js';

function appWith(limit: number) {
  const app = express();
  app.use(createAiRouteRateLimit({ limit, skip: () => false }));
  app.post('/api/ai/route', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('AI route rate limit', () => {
  it('allows requests up to the limit, then returns 429 with the shared error shape', async () => {
    const app = appWith(2);

    await request(app).post('/api/ai/route').expect(200);
    await request(app).post('/api/ai/route').expect(200);

    const blocked = await request(app).post('/api/ai/route');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['ratelimit-limit']).toBe('2');
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });

  it('ignores unrelated paths', async () => {
    const app = express();
    app.use('/api/ai/route', createAiRouteRateLimit({ limit: 1, skip: () => false }));
    app.get('/api/ai/health', (_req, res) => {
      res.json({ ok: true });
    });

    await request(app).get('/api/ai/health').expect(200);
    await request(app).get('/api/ai/health').expect(200);
  });
});
