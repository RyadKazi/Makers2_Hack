import { z } from 'zod';
import { LangSchema } from '../../lib/i18n.js';
import { IsoDateTime } from '../../openapi/schemas.js';

export const RoleSchema = z.enum(['STUDENT', 'TEACHER', 'ADMIN', 'CLUB']).meta({ id: 'Role' });

export const MobilityProfileSchema = z
  .enum(['NONE', 'WHEELCHAIR', 'REDUCED_MOBILITY', 'BLIND_LOW_VISION', 'DEAF_HARD_OF_HEARING', 'SPEECH'])
  .meta({ id: 'MobilityProfile', description: 'Self-declared, coarse. Private to the user.' });

const profileFields = {
  mobility: MobilityProfileSchema,
  stepFree: z.boolean(),
  requireVerifiedRamps: z.boolean(),
  maxSlopePercent: z.number().min(0).max(20).nullable(),
  minPassageWidthCm: z.number().int().min(50).max(250).nullable(),
  avoidClosedPassages: z.boolean(),
  audioGuidance: z.boolean(),
  shorelineHints: z.boolean(),
  captions: z.boolean(),
  textToSpeech: z.boolean(),
  highContrast: z.boolean(),
  reducedMotion: z.boolean(),
  textScale: z.number().min(1).max(2),
};

export const AccessibilityProfileSchema = z
  .object({ ...profileFields, updatedAt: IsoDateTime.nullable().describe('null until the user saves a profile') })
  .meta({ id: 'AccessibilityProfile' });

export const UpdateAccessibilityProfileBody = z
  .object(profileFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field')
  .meta({ id: 'UpdateAccessibilityProfile' });

export const UserSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    displayName: z.string(),
    role: RoleSchema,
    locale: LangSchema,
    createdAt: IsoDateTime,
  })
  .meta({ id: 'User' });

export const MeSchema = UserSchema.extend({ accessibilityProfile: AccessibilityProfileSchema }).meta({ id: 'Me' });

export const AuthSessionSchema = z
  .object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().describe('Access token lifetime in seconds'),
    user: MeSchema,
  })
  .meta({ id: 'AuthSession', description: 'The refresh token is set as an httpOnly cookie (cw_rt), never returned in the body.' });

export const RegisterBody = z
  .object({
    email: z.email().max(254),
    password: z.string().min(10, 'At least 10 characters').max(128),
    displayName: z.string().trim().min(2).max(80),
    locale: LangSchema.optional(),
  })
  .strict()
  .meta({ id: 'RegisterRequest' });

export const LoginBody = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict()
  .meta({ id: 'LoginRequest' });

export const UpdateMeBody = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    locale: LangSchema.optional(),
  })
  .strict()
  .refine((v) => v.displayName !== undefined || v.locale !== undefined, 'Provide displayName and/or locale')
  .meta({ id: 'UpdateMeRequest' });
