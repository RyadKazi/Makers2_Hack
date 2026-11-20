/**
 * Text-to-speech through Cartesia (Sonic). The API key never leaves the server.
 *
 * - One voice per language (CARTESIA_VOICE_ID_AR / _FR / _EN), falling back to CARTESIA_VOICE_ID.
 *   A language with no voice is reported as unavailable, and the client uses the browser voice.
 * - Navigation repeats the same sentences, so audio is cached in memory
 *   (LRU, bounded by entry count and bytes).
 */
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { LANGS, type Lang } from '../../lib/i18n.js';
import { logger } from '../../lib/logger.js';

export const TTS_MAX_CHARS = 600;
const TIMEOUT_MS = 10_000;
const CACHE_MAX_ENTRIES = 300;
const CACHE_MAX_BYTES = 30 * 1024 * 1024;

export type TtsAudio = { audio: Buffer; contentType: string; cached: boolean };

function voiceFor(lang: Lang): string | null {
  const perLang = { ar: env.CARTESIA_VOICE_ID_AR, fr: env.CARTESIA_VOICE_ID_FR, en: env.CARTESIA_VOICE_ID_EN }[lang];
  return perLang || env.CARTESIA_VOICE_ID || null;
}

export function ttsLanguages(): Lang[] {
  if (!env.CARTESIA_API_KEY) return [];
  return LANGS.filter((l) => voiceFor(l) !== null);
}

export function speechStatus() {
  const languages = ttsLanguages();
  return {
    tts: {
      available: languages.length > 0,
      provider: 'cartesia' as const,
      model: env.CARTESIA_TTS_MODEL,
      languages,
      maxChars: TTS_MAX_CHARS,
    },
  };
}

// ───────────── cache ─────────────

const cache = new Map<string, Buffer>();
let cacheBytes = 0;

function cacheGet(key: string): Buffer | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // refresh recency
    cache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, audio: Buffer): void {
  if (audio.length > CACHE_MAX_BYTES / 4) return;
  cache.set(key, audio);
  cacheBytes += audio.length;
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const [oldest, buf] = cache.entries().next().value as [string, Buffer];
    cache.delete(oldest);
    cacheBytes -= buf.length;
  }
}

export function clearTtsCache(): void {
  cache.clear();
  cacheBytes = 0;
}

// ───────────── synthesis ─────────────

export async function synthesize(text: string, lang: Lang, speed = 1): Promise<TtsAudio> {
  const voice = voiceFor(lang);
  if (!env.CARTESIA_API_KEY || !voice) {
    throw new HttpError(503, 'TTS_UNAVAILABLE', 'Server text-to-speech is not configured for this language: use the device voice');
  }
  const transcript = text.replace(/\s+/g, ' ').trim();
  const key = createHash('sha256').update(JSON.stringify([env.CARTESIA_TTS_MODEL, voice, lang, speed, transcript])).digest('hex');
  const hit = cacheGet(key);
  if (hit) return { audio: hit, contentType: 'audio/mpeg', cached: true };

  let res: Response;
  try {
    res = await fetch(`${env.CARTESIA_API_URL.replace(/\/$/, '')}/tts/bytes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CARTESIA_API_KEY}`,
        'cartesia-version': env.CARTESIA_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model_id: env.CARTESIA_TTS_MODEL,
        transcript,
        voice: { id: voice },
        language: lang,
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
        ...(speed !== 1 ? { generation_config: { speed } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err }, 'TTS request failed');
    throw new HttpError(502, 'TTS_UPSTREAM_ERROR', 'The speech service did not answer: use the device voice');
  }
  if (!res.ok) {
    logger.warn({ status: res.status, body: (await res.text().catch(() => '')).slice(0, 300) }, 'TTS upstream error');
    throw new HttpError(502, 'TTS_UPSTREAM_ERROR', 'The speech service failed: use the device voice');
  }
  const audio = Buffer.from(await res.arrayBuffer());
  cachePut(key, audio);
  return { audio, contentType: 'audio/mpeg', cached: false };
}
