import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

type Options = {
  /** Requests allowed per minute (defaults to AI_RATE_LIMIT_PER_MINUTE). */
  limit?: number;
  /** Disable the limiter, e.g. in tests. */
  skip?: () => boolean;
};

/**
 * Dedicated limiter for the public AI route gateway. Each request makes Node call
 * the Python Dijkstra service and PostgreSQL, so it is capped separately from the
 * general API limiter.
 */
export function createAiRouteRateLimit(options: Options = {}) {
  return rateLimit({
    windowMs: 60_000,
    limit: options.limit ?? env.AI_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: options.skip ?? (() => env.NODE_ENV === 'test'),
    message: { error: { code: 'RATE_LIMITED', message: 'Too many route requests, please slow down.' } },
  });
}
