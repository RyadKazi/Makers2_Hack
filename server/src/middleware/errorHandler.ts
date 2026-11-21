import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.path} not found`));
};

function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const status = (err as { status: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/** Single JSON error shape: { error: { code, message, details? } }. Never leaks stack traces. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }

  // body-parser errors (malformed JSON, payload too large…) carry a 4xx status
  const status = clientErrorStatus(err);
  if (status !== undefined) {
    const type = (err as { type?: unknown }).type;
    const code = typeof type === 'string' ? type.toUpperCase().replace(/\./g, '_') : 'BAD_REQUEST';
    res.status(status).json({ error: { code, message: 'Invalid request' } });
    return;
  }

  logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};
