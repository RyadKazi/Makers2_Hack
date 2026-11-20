/** Admin views: aggregates only (k-anonymous), plus the map-correction and recommendation workflows. */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MapCorrection, Prisma, Recommendation } from '@prisma/client';
import type { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import type { Lang } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { algiersDayKey } from '../../lib/time.js';
import { lastAggregation } from '../mobility/pipeline.js';
import { CELL_SIZE_M, K_MIN, RAW_RETENTION_DAYS } from '../mobility/privacy.js';
import { rationale, title, type Evidence } from '../mobility/recommendations.js';
import { getCampusGraph } from '../routing/graph.repository.js';
import { describeEdge } from '../routing/planner.js';
import { statusesByRoom } from '../rooms/rooms.service.js';
import { EdgePatchSchema, type ApproveBody, type HeatmapQuery } from './admin.schemas.js';
import { sanitizeFloorSvg } from './svg.js';

// ───────── heatmap ─────────

export async function heatmap(q: z.output<typeof HeatmapQuery>) {
  const cells = await prisma.heatmapCell.findMany({
    where: { period: q.period, segment: q.category, contributorCount: { gte: K_MIN }, ...(q.level !== undefined ? { level: q.level } : {}) },
    orderBy: [{ level: 'asc' }, { cellY: 'asc' }, { cellX: 'asc' }],
  });
  const first = cells[0];
  return {
    period: q.period,
    category: q.category,
    windowStart: first?.windowStart.toISOString() ?? null,
    windowEnd: first?.windowEnd.toISOString() ?? null,
    computedAt: first?.computedAt.toISOString() ?? null,
    cellSizeM: first?.cellSizeM ?? CELL_SIZE_M,
    kMin: K_MIN,
    cells: cells.map((c) => ({
      level: c.level,
      cellX: c.cellX,
      cellY: c.cellY,
      x: c.x,
      y: c.y,
      visits: c.visitCount,
      contributors: c.contributorCount,
      difficulty: c.difficultyCount,
      stuck: c.stuckCount,
    })),
  };
}

// ───────── hotspots ─────────

export async function hotspots(level: number | undefined) {
  const [rows, graph] = await Promise.all([
    prisma.hotspot.findMany({ where: { contributorCount: { gte: K_MIN }, ...(level !== undefined ? { level } : {}) }, orderBy: { eventCount: 'desc' } }),
    getCampusGraph(),
  ]);
  return {
    kMin: K_MIN,
    items: rows.map((h) => {
      const e = h.edgeId ? graph.edgeById.get(h.edgeId) : undefined;
      return {
        id: h.id,
        level: h.level,
        floorId: h.floorId,
        x: h.x,
        y: h.y,
        radiusM: h.radiusM,
        eventCount: h.eventCount,
        contributorCount: h.contributorCount,
        dominantType: h.dominantType,
        byType: h.byType as Record<string, number>,
        byCategory: h.byCategory as Record<string, number>,
        edge: e
          ? { id: e.id, description: describeEdge(graph, e), hasStairs: e.hasStairs, isRamp: e.isRamp, slopePercent: e.slopePercent, widthCm: Math.min(e.widthCm, e.doorClearanceCm ?? Infinity), isOpen: e.isOpen }
          : null,
        shoreline: h.wallId && h.wallKind && h.wallSide ? { wallId: h.wallId, wallKind: h.wallKind, side: h.wallSide, distanceM: h.wallDistanceM ?? 0 } : null,
        computedAt: h.computedAt.toISOString(),
      };
    }),
  };
}

// ───────── corrections ─────────

async function correctionDto(c: MapCorrection & { reviewedBy: { displayName: string } | null }) {
  const graph = await getCampusGraph();
  const e = c.edgeId ? graph.edgeById.get(c.edgeId) : undefined;
  return {
    id: c.id,
    kind: c.kind,
    source: c.source,
    status: c.status,
    title: c.title,
    description: c.description,
    edgeId: c.edgeId,
    edgeDescription: e ? describeEdge(graph, e) : null,
    level: c.level,
    x: c.x,
    y: c.y,
    proposed: (c.proposed as Record<string, unknown> | null) ?? null,
    evidenceCount: c.evidenceCount,
    createdAt: c.createdAt.toISOString(),
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
    reviewedBy: c.reviewedBy?.displayName ?? null,
    reviewNote: c.reviewNote,
  };
}

const WITH_REVIEWER = { reviewedBy: { select: { displayName: true } } } as const;

export async function listCorrections(status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | undefined, limit: number) {
  const rows = await prisma.mapCorrection.findMany({
    where: status ? { status } : {},
    include: WITH_REVIEWER,
    orderBy: [{ status: 'asc' }, { evidenceCount: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return { items: await Promise.all(rows.map(correctionDto)) };
}

async function pending(id: string) {
  const c = await prisma.mapCorrection.findUnique({ where: { id } });
  if (!c) throw HttpError.notFound(`Correction ${id} not found`);
  if (c.status !== 'PENDING') throw new HttpError(409, 'ALREADY_REVIEWED', `This correction was already ${c.status.toLowerCase()}`);
  return c;
}

/**
 * Applies the proposed (and possibly adjusted) changes to the passage, marks the
 * correction ACCEPTED, then publishes edge.changed: the routing graph reloads,
 * floors get edge:status, and routes through the passage get route:invalidated.
 */
export async function approveCorrection(id: string, adminId: string, body: z.output<typeof ApproveBody>) {
  const c = await pending(id);
  const merged = { ...((c.proposed as Record<string, unknown> | null) ?? {}), ...(body.apply ?? {}) };
  const parsed = EdgePatchSchema.safeParse(merged);
  if (!parsed.success) throw new HttpError(422, 'INVALID_PROPOSAL', 'The proposed changes are not valid passage attributes', parsed.error.issues);
  const patch = parsed.data;
  const applies = c.edgeId !== null && Object.keys(patch).length > 0;
  if (Object.keys(patch).length > 0 && !c.edgeId) throw new HttpError(422, 'NO_EDGE', 'This correction is not attached to a passage');
  if (patch.isOpen === true) patch.closedReason = null;

  const updated = await prisma.$transaction(async (tx) => {
    if (applies) await tx.navEdge.update({ where: { id: c.edgeId! }, data: patch as Prisma.NavEdgeUpdateInput });
    return tx.mapCorrection.update({
      where: { id },
      data: { status: 'ACCEPTED', reviewedAt: new Date(), reviewedById: adminId, reviewNote: body.note ?? null, proposed: merged as Prisma.InputJsonValue },
      include: WITH_REVIEWER,
    });
  });
  if (applies) bus.emit('edge.changed', { edgeId: c.edgeId! });
  bus.emit('admin.correction', { id, status: 'ACCEPTED', created: false });
  return { correction: await correctionDto(updated), applied: applies ? patch : null };
}

export async function rejectCorrection(id: string, adminId: string, note: string) {
  await pending(id);
  const updated = await prisma.mapCorrection.update({
    where: { id },
    data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: adminId, reviewNote: note },
    include: WITH_REVIEWER,
  });
  bus.emit('admin.correction', { id, status: 'REJECTED', created: false });
  return { correction: await correctionDto(updated), applied: null };
}

// ───────── recommendations ─────────

export const SCORE_FORMULA =
  'impact = disabled-student passes/week × stuck-or-blocked rate × detour (m, step-free way around; 300 m if none); score = 100 × (1 − e^(−impact/1500))';

function recommendationDto(r: Recommendation, lang: Lang) {
  const evidence = r.evidence as unknown as Evidence;
  const engine = r.key !== null && typeof evidence?.place === 'string';
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: engine ? title(evidence, lang) : r.title,
    rationale: engine ? rationale(evidence, lang) : r.rationale,
    score: r.score,
    evidence: r.evidence as Record<string, unknown>,
    level: r.level,
    x: r.x,
    y: r.y,
    edgeId: r.edgeId,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listRecommendations(status: Recommendation['status'] | undefined, lang: Lang) {
  const rows = await prisma.recommendation.findMany({ where: status ? { status } : {}, orderBy: [{ score: 'desc' }] });
  return { formula: SCORE_FORMULA, items: rows.map((r) => recommendationDto(r, lang)) };
}

export async function updateRecommendation(id: string, status: Recommendation['status'], lang: Lang) {
  const exists = await prisma.recommendation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw HttpError.notFound(`Recommendation ${id} not found`);
  const r = await prisma.recommendation.update({ where: { id }, data: { status } });
  bus.emit('admin.recommendation', { id, status });
  return recommendationDto(r, lang);
}

// ───────── stats ─────────

const suppress = (n: number): number | null => (n >= K_MIN ? n : null);

export async function stats(now: Date) {
  const since7d = new Date(now.getTime() - 7 * 86_400_000);
  const today = algiersDayKey(now);
  const [active, todaySessions, week, contributorsToday, contributors7d, categories, events, points, oldest, pendingCorrections, openRecommendations, hotspotCount] =
    await Promise.all([
      prisma.trackingSession.count({ where: { endedAt: null } }),
      prisma.trackingSession.count({ where: { dayKey: today } }),
      prisma.trackingSession.count({ where: { startedAt: { gte: since7d } } }),
      prisma.trackingSession.findMany({ where: { dayKey: today }, distinct: ['pseudoId'], select: { pseudoId: true } }),
      prisma.trackingSession.findMany({ where: { startedAt: { gte: since7d } }, distinct: ['pseudoId'], select: { pseudoId: true } }),
      prisma.$queryRaw<{ category: string; sessions: number; contributors: number }[]>`
        SELECT mobility::text AS category, count(*)::int AS sessions, count(DISTINCT "pseudoId")::int AS contributors
        FROM tracking_sessions WHERE "startedAt" >= ${since7d} GROUP BY mobility`,
      prisma.$queryRaw<{ type: string; detected: boolean; n: number }[]>`
        SELECT type::text AS type, (detector IS NOT NULL) AS detected, count(*)::int AS n
        FROM difficulty_events WHERE "recordedAt" >= ${since7d} GROUP BY 1, 2`,
      prisma.trackPoint.count(),
      prisma.trackPoint.findFirst({ orderBy: { recordedAt: 'asc' }, select: { recordedAt: true } }),
      prisma.mapCorrection.count({ where: { status: 'PENDING' } }),
      prisma.recommendation.count({ where: { status: 'OPEN' } }),
      prisma.hotspot.count(),
    ]);

  const categories7d: { category: string; sessions: number; contributors: number }[] = [];
  const other = { category: 'OTHER', sessions: 0, contributors: 0 };
  for (const c of categories) {
    if (c.contributors >= K_MIN) categories7d.push(c);
    else {
      other.sessions += c.sessions;
      other.contributors += c.contributors;
    }
  }
  if (other.contributors >= K_MIN) categories7d.push(other);

  const reported: Record<string, number> = {};
  const detected: Record<string, number> = {};
  for (const e of events) (e.detected ? detected : reported)[e.type] = e.n;

  return {
    generatedAt: now.toISOString(),
    kMin: K_MIN,
    retentionDays: RAW_RETENTION_DAYS,
    sessions: { active: suppress(active)!, today: suppress(todaySessions)!, last7d: suppress(week)! },
    contributors: { today: suppress(contributorsToday.length), last7d: suppress(contributors7d.length) },
    categories7d: categories7d.sort((a, b) => b.sessions - a.sessions),
    events7d: { reported, detected },
    rawData: { points, oldestPointAt: oldest?.recordedAt.toISOString() ?? null },
    queue: { pendingCorrections, openRecommendations, hotspots: hotspotCount },
    lastAggregationAt: lastAggregation?.computedAt ?? null,
  };
}

// ───────── SVG Floor Plans & Architecture ─────────

const SVG_DIR = path.resolve(process.cwd(), 'data', 'floor_svgs');

async function ensureSvgDir() {
  await fs.mkdir(SVG_DIR, { recursive: true });
}

function svgFilePath(floorId: string) {
  return path.join(SVG_DIR, `${floorId}.svg`);
}

function generateDefaultArchitecturalSvg(
  floor: {
    id: string;
    level: number;
    name: string;
    building: { code: string; name: string };
  },
  rooms: Array<{
    id?: string;
    code: string;
    name: string;
    capacity: number;
    wheelchairSpaces: number;
    type: string;
    status?: {
      status: 'AVAILABLE' | 'TEACHER' | 'ADMIN' | 'CLUB';
      occupantName: string | null;
      title: string | null;
    };
  }>,
) {
  const buildingCode = floor.building.code;
  const levelPrefix = floor.level === 0 ? '1' : `${floor.level + 1}`;

  // Default room codes matching the floor architecture: 101, 102, 103, 104, 105, 106, 107, 108
  const defaultCodes = [
    `${buildingCode}-${levelPrefix}01`,
    `${buildingCode}-${levelPrefix}02`,
    `${buildingCode}-${levelPrefix}03`,
    `${buildingCode}-${levelPrefix}04`,
    `${buildingCode}-${levelPrefix}05`,
    `${buildingCode}-${levelPrefix}06`,
    `${buildingCode}-${levelPrefix}07`,
    `${buildingCode}-${levelPrefix}08`,
  ];

  const getRoom = (idx: number, fallbackCode: string) => {
    const r = rooms.find((x) => x.code === fallbackCode) ?? rooms[idx];
    return {
      code: r?.code ?? fallbackCode,
      name: r?.name ?? 'Salle',
      status: r?.status?.status ?? (idx === 1 || idx === 6 ? 'ADMIN' : idx === 2 ? 'CLUB' : 'AVAILABLE'),
      occupant: r?.status?.occupantName || r?.status?.title || '',
    };
  };

  const r101 = getRoom(0, defaultCodes[0]!);
  const r102 = getRoom(1, defaultCodes[1]!);
  const r103 = getRoom(2, defaultCodes[2]!);
  const r104 = getRoom(3, defaultCodes[3]!);
  const r105 = getRoom(4, defaultCodes[4]!);
  const r106 = getRoom(5, defaultCodes[5]!);
  const r107 = getRoom(6, defaultCodes[6]!);
  const r108 = getRoom(7, defaultCodes[7]!);

  const roomColor = (st: string) => {
    if (st === 'ADMIN') return { bg: '#FEE2E2', border: '#F87171', badgeBg: '#EF4444', icon: '👥' };
    if (st === 'CLUB') return { bg: '#FEF3C7', border: '#F59E0B', badgeBg: '#D97706', icon: '★' };
    return { bg: '#DCFCE7', border: '#22C55E', badgeBg: '#16A34A', icon: '✔' };
  };

  const c101 = roomColor(r101.status);
  const c102 = roomColor(r102.status);
  const c103 = roomColor(r103.status);
  const c104 = roomColor(r104.status);
  const c105 = roomColor(r105.status);
  const c106 = roomColor(r106.status);
  const c107 = roomColor(r107.status);
  const c108 = roomColor(r108.status);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 1020 640" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0F172A" flood-opacity="0.12" />
    </filter>
    <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#2563EB" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Architectural Background Canvas (Light theme matching user design) -->
  <rect width="1020" height="640" fill="#F8FAFC" />

  <!-- Outer Floor Boundary Slab -->
  <path d="M 60 70 L 960 70 L 960 280 L 980 280 L 980 480 L 960 480 L 960 600 L 60 600 L 60 300 L 40 300 L 40 100 L 60 100 Z" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2.5" />

  <!-- Corridors & Internal Wall Partitions -->
  <path d="M 70 270 L 950 270 M 70 380 L 950 380" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="4,4" />

  <!-- ==================== TOP ROW ROOMS ==================== -->
  <!-- Room 101 -->
  <g id="room-${r101.code}">
    <rect x="75" y="85" width="160" height="180" rx="8" fill="${c101.bg}" stroke="${c101.border}" stroke-width="2.5" />
    <circle cx="155" cy="140" r="15" fill="${c101.badgeBg}" />
    <text x="155" y="146" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c101.icon}</text>
    <text x="155" y="195" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r101.code}</text>
  </g>

  <!-- Room 102 -->
  <g id="room-${r102.code}">
    <rect x="245" y="85" width="180" height="180" rx="8" fill="${c102.bg}" stroke="${c102.border}" stroke-width="2.5" />
    <circle cx="335" cy="140" r="15" fill="${c102.badgeBg}" />
    <text x="335" y="146" text-anchor="middle" fill="#FFFFFF" font-size="13" font-weight="900">${c102.icon}</text>
    <text x="335" y="195" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r102.code}</text>
  </g>

  <!-- Room 103 -->
  <g id="room-${r103.code}">
    <rect x="435" y="125" width="165" height="140" rx="8" fill="${c103.bg}" stroke="${c103.border}" stroke-width="2.5" />
    <circle cx="517" cy="165" r="15" fill="${c103.badgeBg}" />
    <text x="517" y="171" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c103.icon}</text>
    <text x="517" y="215" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r103.code}</text>
  </g>

  <!-- Room 104 (Selected Target Room) -->
  <g id="room-${r104.code}">
    <rect x="610" y="80" width="165" height="185" rx="8" fill="${c104.bg}" stroke="#16A34A" stroke-width="3.5" />
    <circle cx="692" cy="140" r="15" fill="${c104.badgeBg}" />
    <text x="692" y="146" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c104.icon}</text>
    <text x="692" y="195" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r104.code}</text>
  </g>

  <!-- Room 105 -->
  <g id="room-${r105.code}">
    <rect x="785" y="125" width="155" height="140" rx="8" fill="${c105.bg}" stroke="${c105.border}" stroke-width="2.5" />
    <circle cx="862" cy="165" r="15" fill="${c105.badgeBg}" />
    <text x="862" y="171" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c105.icon}</text>
    <text x="862" y="215" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r105.code}</text>
  </g>

  <!-- ==================== BOTTOM ROW ROOMS ==================== -->
  <!-- Room 106 -->
  <g id="room-${r106.code}">
    <rect x="75" y="380" width="180" height="200" rx="8" fill="${c106.bg}" stroke="${c106.border}" stroke-width="2.5" />
    <circle cx="165" cy="445" r="15" fill="${c106.badgeBg}" />
    <text x="165" y="451" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c106.icon}</text>
    <text x="165" y="500" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r106.code}</text>
  </g>

  <!-- Central Amenities: Elevator & Restrooms -->
  <!-- Elevator -->
  <g id="poi-elevator" transform="translate(320, 395)">
    <rect width="70" height="70" rx="12" fill="#2563EB" filter="url(#shadow)" />
    <!-- Elevator Double Doors & Direction -->
    <rect x="17" y="16" width="16" height="38" rx="2" fill="#FFFFFF" />
    <rect x="37" y="16" width="16" height="38" rx="2" fill="#FFFFFF" />
    <polygon points="12,35 6,35 9,30" fill="#FFFFFF" />
    <polygon points="58,35 64,35 61,40" fill="#FFFFFF" />
  </g>

  <!-- Restrooms (WC) -->
  <g id="poi-restrooms" transform="translate(470, 395)">
    <rect width="70" height="70" rx="12" fill="#2563EB" filter="url(#shadow)" />
    <!-- Man & Woman WC Glyphs -->
    <circle cx="26" cy="22" r="5" fill="#FFFFFF" />
    <path d="M 21 29 L 31 29 L 31 45 L 28 45 L 28 55 L 24 55 L 24 45 L 21 45 Z" fill="#FFFFFF" />
    <circle cx="44" cy="22" r="5" fill="#FFFFFF" />
    <path d="M 38 29 L 50 29 L 52 44 L 46 44 L 46 55 L 42 55 L 42 44 L 36 44 Z" fill="#FFFFFF" />
  </g>

  <!-- Room 107 -->
  <g id="room-${r107.code}">
    <rect x="630" y="400" width="180" height="180" rx="8" fill="${c107.bg}" stroke="${c107.border}" stroke-width="2.5" />
    <circle cx="720" cy="460" r="15" fill="${c107.badgeBg}" />
    <text x="720" y="466" text-anchor="middle" fill="#FFFFFF" font-size="13" font-weight="900">${c107.icon}</text>
    <text x="720" y="515" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r107.code}</text>
  </g>

  <!-- Room 108 -->
  <g id="room-${r108.code}">
    <rect x="825" y="380" width="150" height="200" rx="8" fill="${c108.bg}" stroke="${c108.border}" stroke-width="2.5" />
    <circle cx="900" cy="445" r="15" fill="${c108.badgeBg}" />
    <text x="900" y="451" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c108.icon}</text>
    <text x="900" y="500" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r108.code}</text>
  </g>

  <!-- ==================== POI BADGES (AROUND PERIMETER) ==================== -->
  <!-- Top-Left Emergency Exit -->
  <g id="poi-exit-left" transform="translate(30, 110)">
    <rect width="36" height="36" rx="8" fill="#16A34A" />
    <text x="18" y="25" text-anchor="middle" fill="#FFFFFF" font-size="18">🏃</text>
  </g>

  <!-- Middle-Left Stairs -->
  <g id="poi-stairs" transform="translate(20, 450)">
    <rect width="44" height="44" rx="10" fill="#818CF8" />
    <path d="M 12 32 L 20 32 L 20 24 L 28 24 L 28 16 L 36 16" stroke="#FFFFFF" stroke-width="3" fill="none" stroke-linecap="round" />
  </g>

  <!-- Right PMR Wheelchair Access -->
  <g id="poi-pmr" transform="translate(965, 285)">
    <rect width="38" height="38" rx="8" fill="#818CF8" />
    <text x="19" y="27" text-anchor="middle" fill="#FFFFFF" font-size="22" font-weight="bold">♿</text>
  </g>

  <!-- Bottom-Right Emergency Exit -->
  <g id="poi-exit-right" transform="translate(965, 420)">
    <rect width="36" height="36" rx="8" fill="#16A34A" />
    <text x="18" y="25" text-anchor="middle" fill="#FFFFFF" font-size="18">🏃</text>
  </g>

  <!-- ==================== BLUE NAVIGATION ROUTE ==================== -->
  <!-- Curved Route Polyline (Exact curve from image) -->
  <path d="M 325 540 L 375 490 Q 400 465 435 465 L 455 465 Q 485 465 485 435 L 485 375 Q 485 345 515 345 L 665 345 Q 692 345 692 315 L 692 275" fill="none" stroke="#2563EB" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" filter="url(#routeGlow)" />

  <!-- Start Location Pin: Blue Circle with Navigation Arrow -->
  <g id="route-start" transform="translate(325, 540)">
    <circle cx="0" cy="0" r="23" fill="#FFFFFF" stroke="#93C5FD" stroke-width="3" filter="url(#shadow)" />
    <circle cx="0" cy="0" r="17" fill="#2563EB" />
    <path d="M 0 -10 L 7 8 L 0 5 L -7 8 Z" fill="#FFFFFF" />
  </g>

  <!-- Destination Pin: Purple Pin at A-104 Door -->
  <g id="route-destination" transform="translate(692, 275)">
    <circle cx="0" cy="0" r="16" fill="#7C3AED" filter="url(#shadow)" />
    <circle cx="0" cy="0" r="6" fill="#FFFFFF" />
  </g>

  <!-- ==================== POPOVER TOOLTIP CALLOUT ==================== -->
  <g id="callout-tooltip" transform="translate(692, 25)">
    <rect x="-115" y="0" width="230" height="38" rx="10" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" filter="url(#shadow)" />
    <polygon points="-8,38 8,38 0,46" fill="#FFFFFF" />
    <text x="0" y="24" text-anchor="middle" font-size="13" font-family="system-ui, -apple-system, sans-serif">
      <tspan fill="#0F172A" font-weight="900">${r104.code} · </tspan>
      <tspan fill="#16A34A" font-weight="900">Available</tspan>
      <tspan fill="#64748B" font-weight="600"> · until 14:00</tspan>
    </text>
  </g>
</svg>`;
}

export async function listFloorSvgs() {
  await ensureSvgDir();
  const floors = await prisma.floor.findMany({
    include: {
      building: true,
      _count: { select: { rooms: true } },
    },
    orderBy: [{ building: { code: 'asc' } }, { level: 'asc' }],
  });

  const items = await Promise.all(
    floors.map(async (f) => {
      const file = svgFilePath(f.id);
      let hasCustomSvg = false;
      let updatedAt: string | null = null;
      try {
        const stat = await fs.stat(file);
        hasCustomSvg = true;
        updatedAt = stat.mtime.toISOString();
      } catch {
        hasCustomSvg = false;
      }
      return {
        floorId: f.id,
        buildingId: f.buildingId,
        buildingCode: f.building.code,
        buildingName: f.building.name,
        level: f.level,
        floorName: f.name,
        roomCount: f._count.rooms,
        hasCustomSvg,
        updatedAt,
      };
    }),
  );

  return { items };
}

export async function getFloorSvg(floorId: string) {
  await ensureSvgDir();
  const floor = await prisma.floor.findUnique({
    where: { id: floorId },
    include: {
      building: true,
      rooms: {
        select: { id: true, code: true, name: true, capacity: true, wheelchairSpaces: true, type: true },
        orderBy: { code: 'asc' },
      },
    },
  });

  if (!floor) throw HttpError.notFound(`Floor ${floorId} not found`);

  const file = svgFilePath(floor.id);
  try {
    const customContent = await fs.readFile(file, 'utf8');
    const stat = await fs.stat(file);
    const sanitized = sanitizeFloorSvg(customContent);
    return {
      floorId: floor.id,
      buildingCode: floor.building.code,
      buildingName: floor.building.name,
      level: floor.level,
      floorName: floor.name,
      svgContent: sanitized,
      isCustom: true,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    const now = new Date();
    const statuses = await statusesByRoom(
      floor.rooms.map((r) => r.id),
      now,
    );
    const roomsWithStatus = floor.rooms.map((r) => ({
      ...r,
      status: statuses.get(r.id),
    }));
    const generated = generateDefaultArchitecturalSvg(floor, roomsWithStatus);
    return {
      floorId: floor.id,
      buildingCode: floor.building.code,
      buildingName: floor.building.name,
      level: floor.level,
      floorName: floor.name,
      svgContent: generated,
      isCustom: false,
      updatedAt: now.toISOString(),
    };
  }
}

export async function saveFloorSvg(floorId: string, svgContent: string) {
  await ensureSvgDir();
  const floor = await prisma.floor.findUnique({
    where: { id: floorId },
    include: { building: true },
  });

  if (!floor) throw HttpError.notFound(`Floor ${floorId} not found`);

  let sanitized: string;
  try {
    sanitized = sanitizeFloorSvg(svgContent);
  } catch (error) {
    throw HttpError.badRequest(error instanceof Error ? error.message : 'Invalid SVG document');
  }

  const file = svgFilePath(floor.id);
  await fs.writeFile(file, sanitized, 'utf8');
  const stat = await fs.stat(file);

  return {
    floorId: floor.id,
    buildingCode: floor.building.code,
    buildingName: floor.building.name,
    level: floor.level,
    floorName: floor.name,
    svgContent: sanitized,
    isCustom: true,
    updatedAt: stat.mtime.toISOString(),
  };
}

