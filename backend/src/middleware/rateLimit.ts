import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

/** General API limiter. Stricter limiters (e.g. login) are added per route in their modules. */
export const apiRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down.' } },
});
