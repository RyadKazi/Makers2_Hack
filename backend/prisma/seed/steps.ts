/**
 * Seed steps, reusable by the CLI seed (index.ts) and the integration tests.
 */
import { type PrismaClient, type MobilityProfile as DbMobility } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { runMobilityAggregation } from '../../src/modules/mobility/pipeline.js';
import { invalidateCampusGraph } from '../../src/modules/routing/graph.repository.js';
import { KEY_EDGES, toWktLine, toWktPolygon, type CampusModel, type FloorKey } from './campus.js';
import { generateMobility } from './mobility.js';
import { buildReservations, USERS } from './people.js';
import type { Rng } from './random.js';

export const TABLES = [
  'refresh_sessions',
  'hotspots',
  'mobility_consents',
  'pseudonym_salts',
  'recommendations',
  'heatmap_cells',
  'map_corrections',
  'difficulty_events',
  'track_points',
  'tracking_sessions',
  'reservations',
  'rooms',
  'pois',
  'nav_edges',
  'nav_nodes',
  'walls',
  'floors',
  'buildings',
  'campuses',
  'accessibility_profiles',
  'users',
];

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  console.log('⏳ Resetting tables…');
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function seedCampus(prisma: PrismaClient, model: CampusModel): Promise<{ floorIds: Map<FloorKey, string> }> {
  // ───────── Campus, buildings, floors ─────────
  console.log('🏛️  Campus, buildings, floors…');
  const campus = await prisma.campus.create({ data: { name: model.campus.name, nameAr: model.campus.nameAr, timezone: model.campus.timezone } });
  await prisma.$executeRaw`UPDATE campuses SET geofence = ST_GeomFromText(${toWktPolygon(model.campus.geofence)}, 0) WHERE id = ${campus.id}`;

  const buildingIds = new Map<string, string>();
  for (const b of model.buildings) {
    const row = await prisma.building.create({ data: { campusId: campus.id, code: b.code, name: b.name, nameAr: b.nameAr, x: b.x, y: b.y } });
    buildingIds.set(b.code, row.id);
    await prisma.$executeRaw`UPDATE buildings SET footprint = ST_GeomFromText(${toWktPolygon(b.polygon)}, 0) WHERE id = ${row.id}`;
  }

  const floorIds = new Map<FloorKey, string>();
  for (const f of model.floors) {
    const row = await prisma.floor.create({
      data: { buildingId: buildingIds.get(f.buildingCode)!, level: f.level, name: f.name, elevationM: f.elevationM },
    });
    floorIds.set(f.key, row.id);
    await prisma.$executeRaw`UPDATE floors SET outline = ST_GeomFromText(${toWktPolygon(f.polygon)}, 0) WHERE id = ${row.id}`;
  }
  const floorId = (key: FloorKey | null): string | null => (key ? floorIds.get(key)! : null);

  // ───────── Navigation graph ─────────
  console.log(`🧭 Nav graph: ${model.nodes.length} nodes, ${model.edges.length} edges…`);
  await prisma.navNode.createMany({
    data: model.nodes.map((n) => ({ id: n.id, floorId: floorId(n.floorKey), level: n.level, kind: n.kind, label: n.label, landmark: n.landmark, x: n.x, y: n.y })),
  });
  await prisma.navEdge.createMany({
    data: model.edges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      bidirectional: e.bidirectional,
      lengthM: e.lengthM,
      hasStairs: e.hasStairs,
      stepCount: e.stepCount,
      isRamp: e.isRamp,
      slopePercent: e.slopePercent,
      widthCm: e.widthCm,
      doorClearanceCm: e.doorClearanceCm,
      surface: e.surface,
      isElevator: e.isElevator,
      isOpen: e.isOpen,
      closedReason: e.closedReason,
      verified: e.verified,
      wallSide: e.wallSide,
      wallDistanceM: e.wallDistanceM,
      shorelineHint: e.shorelineHint,
    })),
  });
  await prisma.$executeRaw`
    UPDATE nav_edges e SET geom = ST_MakeLine(a.geom, b.geom)
    FROM nav_nodes a, nav_nodes b
    WHERE a.id = e."fromId" AND b.id = e."toId"`;

  // ───────── Rooms, POIs, walls ─────────
  console.log(`🚪 ${model.rooms.length} rooms, ${model.pois.length} POIs, ${model.walls.length} walls…`);
  await prisma.room.createMany({
    data: model.rooms.map((r) => ({
      floorId: floorIds.get(r.floorKey)!,
      code: r.code,
      name: r.name,
      nameAr: r.nameAr,
      type: r.type,
      capacity: r.capacity,
      wheelchairSpaces: r.wheelchairSpaces,
      hearingLoop: r.hearingLoop,
      x: r.x,
      y: r.y,
      doorNodeId: r.doorNodeId,
    })),
  });
  await prisma.$executeRaw`
    UPDATE rooms r SET shape = ST_GeomFromText(t.wkt, 0)
    FROM unnest(${model.rooms.map((r) => r.code)}::text[], ${model.rooms.map((r) => toWktPolygon(r.polygon))}::text[]) AS t(code, wkt)
    WHERE r.code = t.code`;

  await prisma.poi.createMany({
    data: model.pois.map((p) => ({
      floorId: floorId(p.floorKey),
      level: p.level,
      type: p.type,
      name: p.name,
      nameAr: p.nameAr,
      accessible: p.accessible,
      notes: p.notes,
      x: p.x,
      y: p.y,
      navNodeId: p.navNodeId,
    })),
  });

  await prisma.$executeRaw`
    INSERT INTO walls (id, "floorId", level, kind, label, geom)
    SELECT gen_random_uuid()::text, NULLIF(t.fid, ''), t.lvl, t.kind::"WallKind", NULLIF(t.label, ''), ST_GeomFromText(t.wkt, 0)
    FROM unnest(
      ${model.walls.map((w) => floorId(w.floorKey) ?? '')}::text[],
      ${model.walls.map((w) => w.level)}::int[],
      ${model.walls.map((w) => w.kind)}::text[],
      ${model.walls.map((w) => w.label ?? '')}::text[],
      ${model.walls.map((w) => toWktLine(w.line))}::text[]
    ) AS t(fid, lvl, kind, label, wkt)`;
  return { floorIds };
}

/** Demo users (all with `password`) and the timetable around `now`. */
export async function seedPeople(prisma: PrismaClient, now: Date, seedPassword: string, bcryptRounds = 10): Promise<{ userIds: Map<string, string> }> {
  // ───────── Users & reservations ─────────
  console.log(`👥 ${USERS.length} demo users, today's reservations…`);
  const passwordHash = await bcrypt.hash(seedPassword, bcryptRounds);
  const userIds = new Map<string, string>();
  for (const u of USERS) {
    const row = await prisma.user.create({
      data: {
        email: u.email,
        passwordHash,
        displayName: u.displayName,
        role: u.role,
        locale: u.locale,
        ...(u.profile ? { accessibilityProfile: { create: u.profile } } : {}),
      },
    });
    userIds.set(u.key, row.id);
  }

  const roomIds = new Map((await prisma.room.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]));
  const reservations = buildReservations(now);
  await prisma.reservation.createMany({
    data: reservations.map((r) => ({
      roomId: roomIds.get(r.roomCode)!,
      kind: r.kind,
      title: r.title,
      organizer: r.organizer,
      userId: r.userKey ? userIds.get(r.userKey)! : null,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
    })),
  });
  return { userIds };
}

export async function seedMobility(
  prisma: PrismaClient,
  model: CampusModel,
  rng: Rng,
  now: Date,
  floorIds: Map<FloorKey, string>,
  userIds: Map<string, string>,
): Promise<{ cells: number }> {
  const floorId = (key: FloorKey | null): string | null => (key ? floorIds.get(key)! : null);
  // ───────── Synthetic mobility data ─────────
  const sessions = generateMobility(model, rng, now, 300);
  const pointTotal = sessions.reduce((n, s) => n + s.points.length, 0);
  const eventTotal = sessions.reduce((n, s) => n + s.events.length, 0);
  console.log(`🛰️  ${sessions.length} mobility sessions, ${pointTotal} points, ${eventTotal} difficulty events…`);

  await prisma.trackingSession.createMany({
    data: sessions.map((s) => ({
      id: s.id,
      pseudoId: s.pseudoId,
      dayKey: s.dayKey,
      mobility: s.mobility as DbMobility,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      endReason: s.endReason,
      pointCount: s.points.length,
    })),
  });
  const points = sessions.flatMap((s) =>
    s.points.map((p) => ({ sessionId: s.id, recordedAt: p.recordedAt, level: p.level, floorId: floorId(p.floorKey), accuracyM: p.accuracyM, x: p.x, y: p.y })),
  );
  for (let i = 0; i < points.length; i += 5000) {
    await prisma.trackPoint.createMany({ data: points.slice(i, i + 5000) });
  }
  await prisma.difficultyEvent.createMany({
    data: sessions.flatMap((s) =>
      s.events.map((e) => ({
        sessionId: s.id,
        type: e.type,
        mobility: e.mobility as DbMobility,
        level: e.level,
        floorId: floorId(e.floorKey),
        edgeId: e.edgeId,
        note: e.note,
        recordedAt: e.recordedAt,
        x: e.x,
        y: e.y,
      })),
    ),
  });

  // The simulation already contains its STUCK / REROUTED events: mark sessions as analysed.
  await prisma.$executeRaw`UPDATE tracking_sessions SET "analyzedUntil" = "endedAt", "lastPointAt" = "endedAt"`;

  // Entries the crowd pipeline cannot produce: a direct student report and a closure confirmed by an admin.
  const adminId = userIds.get('admin')!;
  await prisma.mapCorrection.createMany({
    data: [
      {
        kind: 'OTHER',
        source: 'USER_REPORT',
        title: 'Ascenseur du Bloc B souvent lent',
        description: 'Signalé par un étudiant : attente de plus de 3 minutes aux heures de pointe.',
        nodeId: 'B0-ELEV',
        evidenceCount: 1,
        x: 202,
        y: 106,
      },
      {
        kind: 'EDGE_CLOSED',
        source: 'ADMIN',
        status: 'ACCEPTED',
        title: 'Passerelle niveau 1 fermée',
        description: 'Fermeture confirmée par le service technique.',
        edgeId: KEY_EDGES.bridge,
        proposed: { isOpen: false, closedReason: 'Passerelle fermée : travaux d’étanchéité' },
        evidenceCount: 1,
        level: 1,
        x: 110,
        y: 100,
        reviewedAt: now,
        reviewedById: adminId,
        reviewNote: 'Travaux prévus jusqu’à la fin du semestre.',
      },
    ],
  });

  console.log('🔥 Aggregation pipeline: heatmap (2 m; today / 7 d / 30 d), DBSCAN hotspots, correction proposals, recommendations…');
  invalidateCampusGraph();
  const summary = await runMobilityAggregation(now, prisma);
  console.log(`   ${JSON.stringify(summary.heatmapCells)} cells, ${summary.hotspots} hotspots, ${summary.newCorrections} proposals, ${summary.recommendations} recommendations`);
  return { cells: Object.values(summary.heatmapCells).reduce((a, b) => a + b, 0) };
}

