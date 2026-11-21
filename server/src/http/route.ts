/**
 * Declarative routes. One spec per endpoint drives, from the same Zod schemas:
 *   - authentication + role guard
 *   - request validation (params / query / body, typed in the handler)
 *   - the response DTO (parsed before sending: unknown keys are stripped, drift is a 500)
 *   - the OpenAPI document served at /docs and /openapi.json
 */
import type { Role } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { resolveLang, type Lang } from '../lib/i18n.js';
import { logger } from '../lib/logger.js';
import { authenticate, getAuthUser, requireRole, type AuthUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { registerRouteDoc } from '../openapi/registry.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type RouteSpec = {
  method: HttpMethod;
  /** Express path relative to the router, e.g. "/:id". */
  path: string;
  summary: string;
  description?: string;
  /** "required": Bearer token; "optional": read if present; "refresh-cookie": documented only (handler reads the cookie). */
  auth?: 'required' | 'optional' | 'refresh-cookie';
  roles?: readonly Role[];
  request?: { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };
  /** Success status. Defaults to 200, or 204 when there is no response schema. */
  status?: number;
  /** Success body schema. Omit for 204 No Content. */
  response?: z.ZodType;
  /** Binary body written by the handler through ctx.res (documented with this content type). */
  rawResponse?: { contentType: string; description: string };
  /** Extra documented error statuses (400/401/403 are added automatically). */
  errors?: readonly number[];
};

type RequestPart<S extends RouteSpec, K extends 'params' | 'query' | 'body'> = S['request'] extends { [P in K]: infer T }
  ? T extends z.ZodType
    ? z.output<T>
    : undefined
  : undefined;

export type RouteContext<S extends RouteSpec> = {
  req: Request;
  res: Response;
  params: RequestPart<S, 'params'>;
  query: RequestPart<S, 'query'>;
  body: RequestPart<S, 'body'>;
  user: S['auth'] extends 'required' ? AuthUser : AuthUser | undefined;
  lang: Lang;
};

type HandlerResult<S extends RouteSpec> = S['response'] extends z.ZodType ? z.input<S['response']> : void;

export type RouteHandler<S extends RouteSpec> = (ctx: RouteContext<S>) => Promise<HandlerResult<S>> | HandlerResult<S>;

export class ResponseValidationError extends Error {
  constructor(route: string, cause: unknown) {
    super(`Response for ${route} does not match its schema`, { cause });
    this.name = 'ResponseValidationError';
  }
}

export function defineRouter(basePath: string, tag: string) {
  const router = Router();

  function route<const S extends RouteSpec>(spec: S, handler: RouteHandler<S>): void {
    registerRouteDoc({ ...spec, path: `${basePath}${spec.path === '/' ? '' : spec.path}` || '/', tag });

    const middlewares = [];
    if (spec.auth === 'required') middlewares.push(authenticate(true));
    else if (spec.auth === 'optional') middlewares.push(authenticate(false));
    if (spec.roles?.length) middlewares.push(requireRole(...spec.roles));
    if (spec.request) middlewares.push(validate(spec.request));

    const label = `${spec.method.toUpperCase()} ${basePath}${spec.path}`;

    router[spec.method](spec.path, ...middlewares, async (req: Request, res: Response) => {
      const validated = (res.locals.validated ?? {}) as Record<string, unknown>;
      const ctx = {
        req,
        res,
        params: validated.params,
        query: validated.query,
        body: validated.body,
        user: getAuthUser(res),
        lang: resolveLang(req),
      } as RouteContext<S>;

      const result = await handler(ctx);
      if (res.headersSent) return;
      if (spec.rawResponse) throw new Error(`${label} declares a raw response but sent nothing`);

      if (!spec.response) {
        res.status(spec.status ?? 204).end();
        return;
      }
      const parsed = spec.response.safeParse(result);
      if (!parsed.success) {
        logger.error({ route: label, issues: parsed.error.issues.slice(0, 5) }, 'response DTO mismatch');
        throw new ResponseValidationError(label, parsed.error);
      }
      res.status(spec.status ?? 200).json(parsed.data);
    });
  }

  return { router, route };
}
