import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { clearTtsCache } from '../src/modules/speech/speech.service.js';
import { prisma, seedTestDatabase, testApp, tokenFor } from './helpers/fixtures.js';

let app: Express;
let token: string;
const saved = { key: env.CARTESIA_API_KEY, voice: env.CARTESIA_VOICE_ID, ar: env.CARTESIA_VOICE_ID_AR };

beforeAll(async () => {
  await seedTestDatabase();
  app = testApp();
  token = await tokenFor(app, 'amina');
});
afterAll(() => prisma.$disconnect());
afterEach(() => {
  env.CARTESIA_API_KEY = saved.key;
  env.CARTESIA_VOICE_ID = saved.voice;
  env.CARTESIA_VOICE_ID_AR = saved.ar;
  vi.unstubAllGlobals();
  clearTtsCache();
});

const tts = (body: object) => request(app).post('/api/speech/tts').set('Authorization', `Bearer ${token}`).send(body);

describe('speech', () => {
  it('reports TTS unavailable without a key, and answers 503 so clients use the device voice', async () => {
    env.CARTESIA_API_KEY = undefined;
    const status = await request(app).get('/api/speech/status');
    expect(status.body).toMatchObject({ tts: { available: false, languages: [], provider: 'cartesia' } });
    const res = await tts({ text: 'Tournez à gauche', lang: 'fr' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TTS_UNAVAILABLE');
  });

  it('requires sign-in and validates the text', async () => {
    expect((await request(app).post('/api/speech/tts').send({ text: 'x', lang: 'fr' })).status).toBe(401);
    expect((await tts({ text: '   ', lang: 'fr' })).status).toBe(400);
    expect((await tts({ text: 'a'.repeat(601), lang: 'fr' })).status).toBe(400);
  });

  it('calls Cartesia with the configured voice and caches the audio', async () => {
    env.CARTESIA_API_KEY = 'sk_car_test';
    env.CARTESIA_VOICE_ID = 'voice-default';
    env.CARTESIA_VOICE_ID_AR = 'voice-ar';
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await request(app).get('/api/speech/status')).body.tts).toMatchObject({ available: true, languages: ['ar', 'fr', 'en'] });

    const first = await tts({ text: 'انعطف  يسارا', lang: 'ar', speed: 0.9 }).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('audio/mpeg');
    expect(first.headers['x-tts-cache']).toBe('miss');
    expect([...(first.body as Buffer)]).toEqual([0x49, 0x44, 0x33, 1, 2, 3]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cartesia.ai/tts/bytes');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk_car_test', 'cartesia-version': '2026-08-14' });
    expect(JSON.parse(init.body as string)).toEqual({
      model_id: 'sonic-3.6',
      transcript: 'انعطف يسارا',
      voice: { id: 'voice-ar' },
      language: 'ar',
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      generation_config: { speed: 0.9 },
    });

    const second = await tts({ text: 'انعطف يسارا', lang: 'ar', speed: 0.9 });
    expect(second.headers['x-tts-cache']).toBe('hit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps provider failures to 502', async () => {
    env.CARTESIA_API_KEY = 'sk_car_test';
    env.CARTESIA_VOICE_ID = 'voice-default';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 402 })));
    const res = await tts({ text: 'Turn left', lang: 'en' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('TTS_UPSTREAM_ERROR');
  });
});
