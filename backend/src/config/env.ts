import 'dotenv/config';
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: csv,
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, 'use e.g. 15m, 1h').default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(11),
  PSEUDONYM_SECRET: z.string().min(32, 'PSEUDONYM_SECRET must be at least 32 characters'),
  MOBILITY_POLICY_VERSION: z.string().min(1).max(40).default('2026-11-v1'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-flash-latest'),
  CARTESIA_API_KEY: z.string().optional(),
  CARTESIA_TTS_MODEL: z.string().default('sonic-3.6'),
  CARTESIA_API_URL: z.url().default('https://api.cartesia.ai'),
  CARTESIA_VERSION: z.string().default('2026-08-14'),
  /** Default voice; per-language voices override it. */
  CARTESIA_VOICE_ID: z.string().optional(),
  CARTESIA_VOICE_ID_AR: z.string().optional(),
  CARTESIA_VOICE_ID_FR: z.string().optional(),
  CARTESIA_VOICE_ID_EN: z.string().optional(),
  CARTESIA_STT_MODEL: z.string().default('ink-2'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

if (new Set([env.JWT_SECRET, env.JWT_REFRESH_SECRET, env.PSEUDONYM_SECRET]).size !== 3) {
  throw new Error('JWT_SECRET, JWT_REFRESH_SECRET and PSEUDONYM_SECRET must all be different.');
}
