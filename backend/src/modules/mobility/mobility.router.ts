import { defineRouter } from '../../http/route.js';
import { deleteMobilityData, getConsent, grantConsent, revokeConsent } from './consent.service.js';
import { ingestPoints, reportEvent } from './ingest.service.js';
import {
  ConsentSchema,
  DeleteDataResultSchema,
  EventBody,
  EventResultSchema,
  GrantConsentBody,
  IngestResultSchema,
  LangOnlyQuery,
  PointsBody,
  RevokeConsentQuery,
  RevokeResultSchema,
  SessionParams,
  SessionStatusSchema,
  StartSessionBody,
} from './mobility.schemas.js';
import { assertConsent } from './consent.service.js';
import { currentStatus, startSession, stopSession } from './sessions.service.js';

const api = defineRouter('/api/mobility', 'Mobility');

const PRIVACY =
  'Privacy by design (Law 18-07): opt-in; inside the campus geofence only; daily-rotating pseudonym, no user id stored with ' +
  'movements; auto-stop on leaving campus, after 3 h and at midnight; raw data deleted after 30 days; admins see k-anonymous aggregates (≥ 5 people).';

// ───────── consent ─────────

api.route(
  { method: 'get', path: '/consent', summary: 'My consent and the current policy', description: PRIVACY, auth: 'required', request: { query: LangOnlyQuery }, response: ConsentSchema },
  ({ user, query, lang }) => getConsent(user.id, query.lang ?? lang),
);

api.route(
  {
    method: 'post',
    path: '/consent',
    summary: 'Opt in to location sharing',
    description: 'Send the policy version that was shown. 409 POLICY_OUTDATED if it is not the current one.',
    auth: 'required',
    request: { body: GrantConsentBody },
    response: ConsentSchema,
    errors: [409],
  },
  ({ user, body, lang }) => grantConsent(user.id, body.policyVersion, new Date(), body.lang ?? lang),
);

api.route(
  {
    method: 'delete',
    path: '/consent',
    summary: 'Opt out',
    description: 'Ends any running session (CONSENT_WITHDRAWN). With `deleteData=true` also deletes the data still linkable to you; otherwise the response offers it.',
    auth: 'required',
    request: { query: RevokeConsentQuery },
    response: RevokeResultSchema,
  },
  ({ user, query, lang }) => revokeConsent(user.id, query.deleteData ?? false, new Date(), query.lang ?? lang),
);

api.route(
  {
    method: 'delete',
    path: '/data',
    summary: 'Delete my mobility data',
    description: 'Deletes every session (points, reports) recorded under your pseudonyms of the last 30 days. Works with or without consent.',
    auth: 'required',
    response: DeleteDataResultSchema,
  },
  async ({ user }) => ({ deleted: await deleteMobilityData(user.id) }),
);

// ───────── sessions ─────────

api.route(
  {
    method: 'post',
    path: '/sessions',
    summary: 'Start sharing (new session)',
    description: `${PRIVACY}\n\nEnds any session already running. Requires consent to the current policy.`,
    auth: 'required',
    request: { body: StartSessionBody },
    status: 201,
    response: SessionStatusSchema,
  },
  async ({ user, body, lang }) => {
    await assertConsent(user.id);
    return startSession(user.id, body.needsCategory, new Date(), body.lang ?? lang);
  },
);

api.route(
  {
    method: 'get',
    path: '/sessions/current',
    summary: 'Sharing status (poll it)',
    description: 'Today’s latest session: ACTIVE (with a reminder during the last 15 minutes) or ENDED with the reason (left campus, 3 h, midnight…).',
    auth: 'required',
    request: { query: LangOnlyQuery },
    response: SessionStatusSchema,
  },
  ({ user, query, lang }) => currentStatus(user.id, new Date(), query.lang ?? lang),
);

api.route(
  { method: 'post', path: '/sessions/:id/stop', summary: 'Stop sharing', auth: 'required', request: { params: SessionParams, query: LangOnlyQuery }, response: SessionStatusSchema, errors: [404] },
  ({ user, params, query, lang }) => stopSession(user.id, params.id, new Date(), query.lang ?? lang),
);

// ───────── ingestion ─────────

api.route(
  {
    method: 'post',
    path: '/points',
    summary: 'Upload positions (≤ 100 per batch)',
    description:
      'Dropped: accuracy > 10 m, outside the session window, positioning jumps (> 3 m/s). The first point outside the campus ' +
      'geofence ends the session (GEOFENCE_EXIT) and is not stored. Positions are smoothed (accuracy-weighted).',
    auth: 'required',
    request: { body: PointsBody },
    response: IngestResultSchema,
    errors: [404, 409],
  },
  ({ user, body, lang }) => ingestPoints(user.id, body, new Date(), body.lang ?? lang),
);

api.route(
  {
    method: 'post',
    path: '/events',
    summary: 'Report a difficulty',
    description: 'BLOCKED, TOO_STEEP or HARD_TO_NAVIGATE, attached to the nearest passage. STUCK and REROUTED are detected automatically.',
    auth: 'required',
    request: { body: EventBody },
    status: 201,
    response: EventResultSchema,
    errors: [404, 409, 422],
  },
  ({ user, body }) => reportEvent(user.id, body, new Date()),
);

export const mobilityRouter = api.router;
