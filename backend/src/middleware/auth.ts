import type { Role } from '@prisma/client';
import type { RequestHandler, Response } from 'express';
import { HttpError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export type AuthUser = { id: string; role: Role };

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Reads `Authorization: Bearer <access token>` into `res.locals.auth`. Rejects only when `required`. */
export function authenticate(required: boolean): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      if (required) return next(HttpError.unauthorized());
      return next();
    }
    const payload = verifyAccessToken(token);
    if (!payload) return next(new HttpError(401, 'INVALID_TOKEN', 'Access token is invalid or expired'));
    const user: AuthUser = { id: payload.userId, role: payload.role };
    res.locals.auth = user;
    next();
  };
}

export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (_req, res, next) => {
    const user = getAuthUser(res);
    if (!user) return next(HttpError.unauthorized());
    if (!roles.includes(user.role)) return next(HttpError.forbidden(`Requires role: ${roles.join(' or ')}`));
    next();
  };
}

export function getAuthUser(res: Response): AuthUser | undefined {
  return res.locals.auth as AuthUser | undefined;
}
