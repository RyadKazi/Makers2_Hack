import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import { prisma } from '../../lib/prisma.js';
import { defineRouter } from '../../http/route.js';
import { IdParam, IsoDateTime } from '../../openapi/schemas.js';
import {
  ApproveBody,
  CorrectionListSchema,
  CorrectionsQuery,
  HeatmapQuery,
  HeatmapSchema,
  HotspotListSchema,
  HotspotsQuery,
  IdParams,
  RecommendationListSchema,
  RecommendationSchema,
  RecommendationsQuery,
  RejectBody,
  ReviewResultSchema,
  StatsSchema,
  UpdateRecommendationBody,
  FloorSvgListSchema,
  FloorSvgSchema,
  UpdateFloorSvgBody,
} from './admin.schemas.js';
import * as admin from './admin.service.js';

/**
 * Admin API (role ADMIN). Mobility views are aggregates only (k-anonymous);
 * live updates on Socket.io namespace /admin.
 */
const api = defineRouter('/api/admin', 'Admin');

const EdgeStatusBody = z
  .object({
    isOpen: z.boolean(),
    closedReason: z.string().trim().min(3).max(200).nullable().optional().describe('Required when closing'),
  })
  .strict()
  .refine((v) => v.isOpen || !!v.closedReason, { message: 'closedReason is required when closing a passage', path: ['closedReason'] })
  .meta({ id: 'UpdateEdgeStatus' });

export const EdgeStatusSchema = z
  .object({ edgeId: z.string(), isOpen: z.boolean(), closedReason: z.string().nullable(), updatedAt: IsoDateTime })
  .meta({ id: 'EdgeStatus' });

api.route(
  {
    method: 'patch',
    path: '/edges/:id/status',
    summary: 'Open or close a passage',
    description: 'Routing excludes closed passages immediately; clients viewing the floor receive `edge:status`.',
    auth: 'required',
    roles: ['ADMIN'],
    request: { params: z.object({ id: IdParam }), body: EdgeStatusBody },
    response: EdgeStatusSchema,
    errors: [404],
  },
  async ({ params, body }) => {
    const exists = await prisma.navEdge.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw HttpError.notFound(`Edge ${params.id} not found`);
    const edge = await prisma.navEdge.update({
      where: { id: params.id },
      data: { isOpen: body.isOpen, closedReason: body.isOpen ? null : (body.closedReason ?? null) },
    });
    bus.emit('edge.changed', { edgeId: edge.id });
    return { edgeId: edge.id, isOpen: edge.isOpen, closedReason: edge.closedReason, updatedAt: edge.updatedAt.toISOString() };
  },
);

const ADMIN = { auth: 'required', roles: ['ADMIN'] } as const;
const PRIVACY = 'Aggregates only: nothing seen by fewer than 5 distinct daily pseudonyms is returned (k-anonymity).';

api.route(
  { method: 'get', path: '/heatmap', summary: 'Mobility heatmap (2 m grid)', description: PRIVACY, ...ADMIN, request: { query: HeatmapQuery }, response: HeatmapSchema },
  ({ query }) => admin.heatmap(query),
);

api.route(
  {
    method: 'get',
    path: '/hotspots',
    summary: 'Difficulty hotspots (DBSCAN, 30 days)',
    description: `${PRIVACY} Each hotspot has its passage and the nearest wall to follow (shoreline).`,
    ...ADMIN,
    request: { query: HotspotsQuery },
    response: HotspotListSchema,
  },
  ({ query }) => admin.hotspots(query.level),
);

api.route(
  { method: 'get', path: '/corrections', summary: 'Map-correction queue', ...ADMIN, request: { query: CorrectionsQuery }, response: CorrectionListSchema },
  ({ query }) => admin.listCorrections(query.status, query.limit),
);

api.route(
  {
    method: 'post',
    path: '/corrections/:id/approve',
    summary: 'Approve a correction (applies it to the passage)',
    description:
      'Writes the proposed changes (optionally adjusted in `apply`) to the NavEdge. Routing reloads the graph and routes through the passage receive `route:invalidated`.',
    ...ADMIN,
    request: { params: IdParams, body: ApproveBody },
    response: ReviewResultSchema,
    errors: [404, 409, 422],
  },
  ({ params, body, user }) => admin.approveCorrection(params.id, user.id, body),
);

api.route(
  { method: 'post', path: '/corrections/:id/reject', summary: 'Reject a correction', ...ADMIN, request: { params: IdParams, body: RejectBody }, response: ReviewResultSchema, errors: [404, 409] },
  ({ params, body, user }) => admin.rejectCorrection(params.id, user.id, body.note),
);

api.route(
  {
    method: 'get',
    path: '/recommendations',
    summary: 'Accessibility investment recommendations',
    description: admin.SCORE_FORMULA,
    ...ADMIN,
    request: { query: RecommendationsQuery },
    response: RecommendationListSchema,
  },
  ({ query, lang }) => admin.listRecommendations(query.status, query.lang ?? lang),
);

api.route(
  {
    method: 'patch',
    path: '/recommendations/:id',
    summary: 'Plan, complete or dismiss a recommendation',
    description: 'The engine refreshes scores every 5 minutes but keeps the status set here.',
    ...ADMIN,
    request: { params: IdParams, body: UpdateRecommendationBody },
    response: RecommendationSchema,
    errors: [404],
  },
  ({ params, body, lang }) => admin.updateRecommendation(params.id, body.status, body.lang ?? lang),
);

api.route({ method: 'get', path: '/stats', summary: 'Mobility statistics', description: PRIVACY, ...ADMIN, response: StatsSchema }, () => admin.stats(new Date()));

api.route(
  {
    method: 'get',
    path: '/floors/svgs',
    summary: 'List all floors and their SVG architecture plan status',
    auth: 'optional',
    response: FloorSvgListSchema,
  },
  () => admin.listFloorSvgs(),
);

api.route(
  {
    method: 'get',
    path: '/floors/:id/svg',
    summary: 'Get SVG floor plan architecture for a floor',
    auth: 'optional',
    request: { params: IdParams },
    response: FloorSvgSchema,
    errors: [404],
  },
  ({ params }) => admin.getFloorSvg(params.id),
);

api.route(
  {
    method: 'put',
    path: '/floors/:id/svg',
    summary: 'Upload or update SVG floor plan architecture for a floor',
    ...ADMIN,
    request: { params: IdParams, body: UpdateFloorSvgBody },
    response: FloorSvgSchema,
    errors: [400, 404],
  },
  ({ params, body }) => admin.saveFloorSvg(params.id, body.svgContent),
);

export const adminRouter = api.router;
