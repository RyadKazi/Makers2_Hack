import type { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

const ISSUER = 'campusway';
const ACCESS_AUDIENCE = 'campusway-api';
const REFRESH_AUDIENCE = 'campusway-refresh';

export const REFRESH_COOKIE = 'cw_rt';
export const REFRESH_COOKIE_PATH = '/api/auth';

export type AccessPayload = { userId: string; role: Role };
export type RefreshPayload = { userId: string; tokenVersion: number };

/** Seconds, from "15m" / "1h" / "30s" / "1d". */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const unit = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

export const ACCESS_TTL_S = durationToSeconds(env.JWT_ACCESS_EXPIRES_IN);
export const REFRESH_TTL_S = env.JWT_REFRESH_EXPIRES_IN_DAYS * 86_400;

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign({ role: payload.role, typ: 'access' }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: payload.userId,
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: ACCESS_TTL_S,
  });
}

export function signRefreshToken(payload: RefreshPayload): string {
  return jwt.sign({ ver: payload.tokenVersion, typ: 'refresh' }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    subject: payload.userId,
    issuer: ISSUER,
    audience: REFRESH_AUDIENCE,
    expiresIn: REFRESH_TTL_S,
  });
}

const ROLES: readonly Role[] = ['STUDENT', 'TEACHER', 'ADMIN'];

/** Returns null for any invalid, expired or wrong-type token. */
export function verifyAccessToken(token: string): AccessPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: ACCESS_AUDIENCE });
    if (typeof decoded !== 'object' || decoded.typ !== 'access' || typeof decoded.sub !== 'string') return null;
    if (!ROLES.includes(decoded.role as Role)) return null;
    return { userId: decoded.sub, role: decoded.role as Role };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: REFRESH_AUDIENCE });
    if (typeof decoded !== 'object' || decoded.typ !== 'refresh' || typeof decoded.sub !== 'string') return null;
    if (typeof decoded.ver !== 'number') return null;
    return { userId: decoded.sub, tokenVersion: decoded.ver };
  } catch {
    return null;
  }
}
