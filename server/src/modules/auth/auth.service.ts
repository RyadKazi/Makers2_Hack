import type { AccessibilityProfile, Prisma, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { CookieOptions, Response } from 'express';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AccessibilityProfileSchema, AuthSessionSchema, MeSchema, RegisterBody, UpdateAccessibilityProfileBody, UpdateMeBody } from './auth.schemas.js';
import { ACCESS_TTL_S, REFRESH_COOKIE, REFRESH_COOKIE_PATH, REFRESH_TTL_S, signAccessToken, signRefreshToken, verifyRefreshToken } from './tokens.js';

type MeDto = z.input<typeof MeSchema>;
type ProfileDto = z.input<typeof AccessibilityProfileSchema>;
type SessionDto = z.input<typeof AuthSessionSchema>;

/** Compared against when the email is unknown, so both paths cost one bcrypt check. */
const DUMMY_HASH = bcrypt.hashSync('campusway-timing-equaliser', 4);

const DEFAULT_PROFILE: ProfileDto = {
  mobility: 'NONE',
  stepFree: false,
  requireVerifiedRamps: false,
  maxSlopePercent: null,
  minPassageWidthCm: null,
  avoidClosedPassages: true,
  audioGuidance: false,
  shorelineHints: false,
  captions: false,
  textToSpeech: false,
  highContrast: false,
  reducedMotion: false,
  textScale: 1,
  updatedAt: null,
};

export function toProfileDto(profile: AccessibilityProfile | null): ProfileDto {
  if (!profile) return DEFAULT_PROFILE;
  const { id: _id, userId: _userId, updatedAt, ...fields } = profile;
  return { ...fields, updatedAt: updatedAt.toISOString() };
}

export function toMeDto(user: User & { accessibilityProfile: AccessibilityProfile | null }): MeDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    locale: user.locale,
    createdAt: user.createdAt.toISOString(),
    accessibilityProfile: toProfileDto(user.accessibilityProfile),
  };
}

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const refreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
  maxAge: REFRESH_TTL_S * 1000,
});

export function clearRefreshCookie(res: Response): void {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, options);
}

/** Issues a new access token and rotates the refresh cookie. */
function startSession(res: Response, user: User & { accessibilityProfile: AccessibilityProfile | null }): SessionDto {
  res.cookie(REFRESH_COOKIE, signRefreshToken({ userId: user.id, tokenVersion: user.tokenVersion }), refreshCookieOptions());
  return {
    accessToken: signAccessToken({ userId: user.id, role: user.role }),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL_S,
    user: toMeDto(user),
  };
}

export async function register(res: Response, input: z.output<typeof RegisterBody>): Promise<SessionDto> {
  const email = normaliseEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new HttpError(409, 'EMAIL_TAKEN', 'An account already exists for this email');

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(input.password, env.BCRYPT_ROUNDS),
      displayName: input.displayName,
      role: 'STUDENT', // Teacher/admin roles are granted by an administrator, never self-assigned.
      ...(input.locale ? { locale: input.locale } : {}),
    },
    include: { accessibilityProfile: true },
  });
  return startSession(res, user);
}

export async function login(res: Response, emailInput: string, password: string): Promise<SessionDto> {
  const user = await prisma.user.findUnique({ where: { email: normaliseEmail(emailInput) }, include: { accessibilityProfile: true } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  return startSession(res, user);
}

export async function refresh(res: Response, cookie: unknown): Promise<SessionDto> {
  const payload = typeof cookie === 'string' ? verifyRefreshToken(cookie) : null;
  const user = payload ? await prisma.user.findUnique({ where: { id: payload.userId }, include: { accessibilityProfile: true } }) : null;
  if (!payload || !user || user.tokenVersion !== payload.tokenVersion) {
    clearRefreshCookie(res);
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');
  }
  return startSession(res, user);
}

/** Revokes every refresh token of the user (all devices). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

async function loadMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { accessibilityProfile: true } });
  if (!user) throw new HttpError(401, 'UNKNOWN_USER', 'This account no longer exists');
  return user;
}

export async function getMe(userId: string): Promise<MeDto> {
  return toMeDto(await loadMe(userId));
}

export async function updateMe(userId: string, input: z.output<typeof UpdateMeBody>): Promise<MeDto> {
  await loadMe(userId);
  const data: Prisma.UserUpdateInput = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.locale !== undefined) data.locale = input.locale;
  const user = await prisma.user.update({ where: { id: userId }, data, include: { accessibilityProfile: true } });
  return toMeDto(user);
}

export async function getProfile(userId: string): Promise<ProfileDto> {
  return toProfileDto((await loadMe(userId)).accessibilityProfile);
}

export async function updateProfile(userId: string, input: z.output<typeof UpdateAccessibilityProfileBody>): Promise<ProfileDto> {
  await loadMe(userId);
  const profile = await prisma.accessibilityProfile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
  return toProfileDto(profile);
}
