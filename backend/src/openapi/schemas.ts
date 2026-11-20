import { z } from 'zod';

/** Every error response: { error: { code, message, details? } }. */
export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ examples: ['VALIDATION_ERROR', 'NOT_FOUND', 'RESERVATION_CONFLICT'] }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

/** ISO-8601 UTC timestamp, e.g. 2026-11-19T08:00:00.000Z */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Database ids are cuids; nav nodes/edges use readable ids. Keep it loose but bounded. */
export const IdParam = z.string().min(1).max(64);

export const HealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    service: z.string(),
    uptimeS: z.number().int(),
    checks: z.object({ database: z.enum(['up', 'down']) }),
    time: IsoDateTime,
  })
  .meta({ id: 'Health' });
