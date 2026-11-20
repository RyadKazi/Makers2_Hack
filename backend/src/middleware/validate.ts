import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { HttpError } from '../lib/errors.js';

export type RequestSchemas = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

/** Shape of `res.locals.validated` after `validate(schemas)` ran. */
export type Validated<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.infer<S[K]> : never;
};

export type ValidationIssue = { location: 'params' | 'query' | 'body'; path: string; message: string };

/**
 * Validates params / query / body with Zod and collects every issue in one 400 response.
 * Parsed (coerced, defaulted) values go to `res.locals.validated`; `req.body` is replaced too
 * (Express 5 makes `req.query` a read-only getter, so read query values from `res.locals`).
 */
export function validate<S extends RequestSchemas>(schemas: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const validated: Record<string, unknown> = {};
    const issues: ValidationIssue[] = [];

    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location]);
      if (result.success) {
        validated[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      next(new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', issues));
      return;
    }
    if ('body' in validated) req.body = validated.body;
    res.locals.validated = validated;
    next();
  };
}
