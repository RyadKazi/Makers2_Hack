import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { defineRouter } from '../../http/route.js';
import { AccessibilityProfileSchema, AuthSessionSchema, LoginBody, MeSchema, RegisterBody, UpdateAccessibilityProfileBody, UpdateMeBody } from './auth.schemas.js';
import * as auth from './auth.service.js';
import { REFRESH_COOKIE } from './tokens.js';

// ───────────── /api/auth ─────────────
const authApi = defineRouter('/api/auth', 'Auth');

/** Brute-force guard on credential endpoints (per IP). */
authApi.router.use(
  ['/login', '/register'],
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again in a few minutes.' } },
  }),
);

authApi.route(
  {
    method: 'post',
    path: '/register',
    summary: 'Create a student account',
    description: 'New accounts are always STUDENT. Sets the refresh cookie.',
    request: { body: RegisterBody },
    status: 201,
    response: AuthSessionSchema,
    errors: [409, 429],
  },
  ({ res, body }) => auth.register(res, body),
);

authApi.route(
  {
    method: 'post',
    path: '/login',
    summary: 'Sign in',
    description: 'Returns a short-lived access token and sets the httpOnly refresh cookie.',
    request: { body: LoginBody },
    response: AuthSessionSchema,
    errors: [401, 429],
  },
  ({ res, body }) => auth.login(res, body.email, body.password),
);

authApi.route(
  {
    method: 'post',
    path: '/refresh',
    summary: 'Get a new access token',
    description: 'Uses the refresh cookie and rotates it.',
    auth: 'refresh-cookie',
    response: AuthSessionSchema,
  },
  ({ req, res }) => auth.refresh(res, (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE]),
);

authApi.route(
  { method: 'post', path: '/logout', summary: 'Sign out on this device', description: 'Clears the refresh cookie.' },
  async ({ req, res }) => {
    await auth.revokeRefreshCookie((req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE]);
    auth.clearRefreshCookie(res);
  },
);

authApi.route(
  { method: 'post', path: '/logout-all', summary: 'Sign out everywhere', description: 'Revokes every refresh token of the account.', auth: 'required' },
  async ({ res, user }) => {
    await auth.revokeAllSessions(user.id);
    auth.clearRefreshCookie(res);
  },
);

export const authRouter = authApi.router;

// ───────────── /api/me ─────────────
const meApi = defineRouter('/api/me', 'Me');

meApi.route({ method: 'get', path: '/', summary: 'Current user and accessibility profile', auth: 'required', response: MeSchema }, ({ user }) =>
  auth.getMe(user.id),
);

meApi.route(
  { method: 'put', path: '/', summary: 'Update display name or language', auth: 'required', request: { body: UpdateMeBody }, response: MeSchema },
  ({ user, body }) => auth.updateMe(user.id, body),
);

meApi.route(
  {
    method: 'get',
    path: '/accessibility-profile',
    summary: 'My accessibility profile',
    description: 'Defaults are returned (updatedAt null) until the user saves one. Visible only to its owner.',
    auth: 'required',
    response: AccessibilityProfileSchema,
  },
  ({ user }) => auth.getProfile(user.id),
);

meApi.route(
  {
    method: 'put',
    path: '/accessibility-profile',
    summary: 'Create or update my accessibility profile',
    description: 'Partial update: omitted fields keep their value.',
    auth: 'required',
    request: { body: UpdateAccessibilityProfileBody },
    response: AccessibilityProfileSchema,
  },
  ({ user, body }) => auth.updateProfile(user.id, body),
);

export const meRouter = meApi.router;
