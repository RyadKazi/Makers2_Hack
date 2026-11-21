import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { defineRouter } from '../../http/route.js';
import { LangSchema } from '../../lib/i18n.js';
import { speechStatus, synthesize, TTS_MAX_CHARS } from './speech.service.js';

const SpeechStatusSchema = z
  .object({
    tts: z.object({
      available: z.boolean().describe('false: use the device voice (speechSynthesis)'),
      provider: z.literal('cartesia'),
      model: z.string(),
      languages: z.array(LangSchema).describe('Languages with a configured voice'),
      maxChars: z.number().int(),
    }),
  })
  .meta({ id: 'SpeechStatus' });

const TtsBody = z
  .object({
    text: z.string().trim().min(1).max(TTS_MAX_CHARS),
    lang: LangSchema,
    speed: z.number().min(0.6).max(1.5).optional().describe('Speaking rate (default 1)'),
  })
  .strict()
  .meta({ id: 'TtsRequest' });

const api = defineRouter('/api/speech', 'Speech');

api.router.use(
  '/tts',
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many speech requests: using the device voice is fine.' } },
  }),
);

api.route(
  { method: 'get', path: '/status', summary: 'Which speech features the server provides', auth: 'optional', response: SpeechStatusSchema },
  () => speechStatus(),
);

api.route(
  {
    method: 'post',
    path: '/tts',
    summary: 'Text to speech (Cartesia Sonic)',
    description:
      'Returns MP3 audio. 503 TTS_UNAVAILABLE when no voice is configured for the language and 502 when the provider fails: ' +
      'clients then use the device voice (speechSynthesis). Results are cached in memory. Limited to 60 requests per minute.',
    auth: 'required',
    request: { body: TtsBody },
    rawResponse: { contentType: 'audio/mpeg', description: 'MP3 audio' },
    errors: [429, 502, 503],
  },
  async ({ body, res }) => {
    const { audio, contentType, cached } = await synthesize(body.text, body.lang, body.speed ?? 1);
    res
      .status(200)
      .set({ 'content-type': contentType, 'cache-control': 'private, max-age=86400', 'x-tts-cache': cached ? 'hit' : 'miss' })
      .send(audio);
  },
);

export const speechRouter = api.router;
