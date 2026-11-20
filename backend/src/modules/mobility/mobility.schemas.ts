import { z } from 'zod';
import { LangSchema } from '../../lib/i18n.js';
import { IdParam, IsoDateTime } from '../../openapi/schemas.js';
import { MobilityProfileSchema } from '../auth/auth.schemas.js';
import { MAX_ACCURACY_M, MAX_BATCH } from './privacy.js';

const Instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const Coord = z.number().min(-100).max(1000);
const Level = z.number().int().min(-5).max(50);

export const ConsentSchema = z
  .object({
    granted: z.boolean(),
    upToDate: z.boolean().describe('Granted for the current policy version (required to share)'),
    policyVersion: z.string().nullable(),
    grantedAt: IsoDateTime.nullable(),
    revokedAt: IsoDateTime.nullable(),
    currentPolicy: z.object({ version: z.string(), summary: z.array(z.string()), retentionDays: z.number().int() }),
  })
  .meta({ id: 'MobilityConsent' });

export const GrantConsentBody = z.object({ policyVersion: z.string().min(1).max(40).describe('The version shown to the user'), lang: LangSchema.optional() }).strict();

export const RevokeConsentQuery = z.object({
  deleteData: z.stringbool().optional().describe('Also delete the data still linkable to you (last 30 days)'),
  lang: LangSchema.optional(),
});

const DeletionSchema = z.object({ sessions: z.number().int(), points: z.number().int(), events: z.number().int() }).meta({ id: 'MobilityDeletion' });

export const RevokeResultSchema = z
  .object({
    consent: ConsentSchema,
    endedSession: z.boolean(),
    deleted: DeletionSchema.nullable(),
    deletionOffer: z.object({ available: z.boolean(), endpoint: z.string(), retainedDays: z.number().int() }).nullable(),
  })
  .meta({ id: 'MobilityConsentRevoked' });

export const DeleteDataResultSchema = z.object({ deleted: DeletionSchema }).meta({ id: 'MobilityDataDeleted' });

export const SessionStatusSchema = z
  .object({
    state: z.enum(['NONE', 'ACTIVE', 'ENDED']),
    message: z.string().nullable().describe('Reminder before an automatic stop, or why the session ended'),
    session: z
      .object({
        id: z.string(),
        needsCategory: MobilityProfileSchema,
        startedAt: IsoDateTime,
        endedAt: IsoDateTime.nullable(),
        endReason: z.enum(['USER', 'GEOFENCE_EXIT', 'TIME_LIMIT', 'DAILY_RESET', 'CONSENT_WITHDRAWN']).nullable(),
        pointCount: z.number().int(),
        lastPointAt: IsoDateTime.nullable(),
        autoStopAt: IsoDateTime,
        autoStopReason: z.enum(['TIME_LIMIT', 'DAILY_RESET']),
        remainingSec: z.number().int(),
        reminder: z.string().nullable().describe('Set during the last 15 minutes'),
      })
      .nullable(),
  })
  .meta({ id: 'MobilitySessionStatus' });

export const StartSessionBody = z
  .object({
    needsCategory: MobilityProfileSchema.optional().describe('Coarse category only. Default: from your accessibility profile.'),
    lang: LangSchema.optional(),
  })
  .strict();

export const SessionParams = z.object({ id: IdParam });
export const LangOnlyQuery = z.object({ lang: LangSchema.optional() });

export const PointsBody = z
  .object({
    sessionId: IdParam,
    points: z
      .array(
        z
          .object({
            recordedAt: Instant,
            x: Coord,
            y: Coord,
            level: Level,
            floorId: IdParam.optional(),
            accuracyM: z.number().min(0).max(1000).describe(`Points above ${MAX_ACCURACY_M} m are dropped`),
            routeId: z.uuid().optional().describe('Planned route being followed (from /api/routes/plan). Route ids are random and not linked to an account.'),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BATCH),
    lang: LangSchema.optional(),
  })
  .strict()
  .meta({ id: 'MobilityPointsBatch' });

export const IngestResultSchema = z
  .object({
    accepted: z.number().int(),
    dropped: z.object({ lowAccuracy: z.number().int(), outsideGeofence: z.number().int(), jitter: z.number().int(), outOfSession: z.number().int() }),
    session: SessionStatusSchema,
  })
  .meta({ id: 'MobilityIngestResult' });

export const EventBody = z
  .object({
    sessionId: IdParam,
    type: z.enum(['BLOCKED', 'TOO_STEEP', 'HARD_TO_NAVIGATE']),
    note: z.string().max(280).optional().describe('Contact details are redacted. Never shown individually to admins.'),
    x: Coord,
    y: Coord,
    level: Level,
    floorId: IdParam.optional(),
    recordedAt: Instant.optional(),
    routeId: z.uuid().optional().describe('Planned route being followed when reporting'),
  })
  .strict()
  .meta({ id: 'MobilityEventReport' });

export const EventResultSchema = z
  .object({ id: z.string(), type: z.string(), edgeId: z.string().nullable().describe('Passage the report was attached to'), recordedAt: IsoDateTime })
  .meta({ id: 'MobilityEventRecorded' });
