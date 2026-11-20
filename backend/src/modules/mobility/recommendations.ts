/**
 * Recommendation engine.
 *
 *   impact = disabled-student passes per week × stuck/blocked rate × detour (m)
 *   score  = 100 × (1 − e^(−impact / 1500))     (0–100, saturating)
 *
 * - passes: distinct sessions of students with a declared need passing within 5 m of
 *   the passage (30 days, scaled to a week).
 * - rate: share of those sessions with a STUCK / BLOCKED / TOO_STEEP / REROUTED event there.
 * - detour: step-free route around the obstacle (routing engine, through the adapter)
 *   minus the direct length; 300 m when there is no step-free way at all.
 * Only hotspots with ≥ K_MIN contributors are considered (k-anonymity).
 */
import type { MobilityProfile, Prisma, RecommendationKind } from '@prisma/client';
import { bus } from '../../lib/events.js';
import type { Lang } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { mergeConstraints } from '../routing/constraints.js';
import type { CampusGraph, RoutingEdge } from '../routing/graph.repository.js';
import { findPath } from '../routing/pathfinder.js';
import { describeEdge } from '../routing/planner.js';
import { periodWindow } from './heatmap.js';
import type { HotspotRow } from './hotspots.js';
import { K_MIN } from './privacy.js';

export const NO_ALTERNATIVE_DETOUR_M = 300;
/** For signage, "detour" is the distance typically lost to U-turns and hesitation. */
export const SIGNAGE_WASTED_M = 20;
const IMPACT_SCALE = 1500;
const PASS_RADIUS_M = 5;

export type Evidence = {
  kind: RecommendationKind;
  place: string;
  category: MobilityProfile;
  passesPerWeek: number;
  passes30d: number;
  contributors: number;
  affectedSessions: number;
  ratePct: number;
  directM: number;
  detourM: number;
  noAlternative: boolean;
  impact: number;
  problem: { stepCount: number; slopePercent: number; verified: boolean; widthCm: number; vertical: boolean };
  hotspotEvents: number;
  byType: Record<string, number>;
};

export function scoreOf(impact: number): number {
  return Math.round(1000 * (1 - Math.exp(-impact / IMPACT_SCALE))) / 10;
}

/** Which intervention fits this passage, or null if the difficulty is not about access. */
export function kindFor(graph: CampusGraph, edge: RoutingEdge, dominant: string, noAlternative: boolean, category?: MobilityProfile): RecommendationKind | null {
  // Getting lost is not fixed with concrete: wayfinding problems (or a blind / low-vision majority) call for signage.
  if (dominant === 'HARD_TO_NAVIGATE' || category === 'BLIND_LOW_VISION') return 'SIGNAGE';
  const a = graph.nodes.get(edge.fromId)!;
  const b = graph.nodes.get(edge.toId)!;
  if (edge.hasStairs) {
    if (a.level !== b.level) return 'ELEVATOR';
    const threshold = a.floorId === null || b.floorId === null || a.kind === 'ENTRANCE' || b.kind === 'ENTRANCE';
    return threshold && noAlternative ? 'ACCESSIBLE_ENTRANCE' : 'RAMP';
  }
  if (edge.isRamp && (edge.slopePercent > 6 || !edge.verified)) return 'RAMP';
  if (Math.min(edge.widthCm, edge.doorClearanceCm ?? Infinity) < 80) return 'WIDEN_DOOR';
  if (dominant === 'HARD_TO_NAVIGATE' || dominant === 'REROUTED' || dominant === 'STUCK') return 'SIGNAGE';
  return null;
}

// ───────────── wording ─────────────

const CATEGORY: Record<Lang, Record<MobilityProfile, string>> = {
  fr: { WHEELCHAIR: 'en fauteuil roulant', REDUCED_MOBILITY: 'à mobilité réduite', BLIND_LOW_VISION: 'd’étudiants malvoyants', DEAF_HARD_OF_HEARING: 'd’étudiants sourds', SPEECH: 'd’étudiants avec un trouble de la parole', NONE: '' },
  en: { WHEELCHAIR: 'wheelchair', REDUCED_MOBILITY: 'reduced-mobility', BLIND_LOW_VISION: 'blind / low-vision', DEAF_HARD_OF_HEARING: 'deaf / hard-of-hearing', SPEECH: 'speech-impaired', NONE: '' },
  ar: { WHEELCHAIR: 'بكرسي متحرك', REDUCED_MOBILITY: 'لذوي الحركة المحدودة', BLIND_LOW_VISION: 'لطلاب مكفوفين أو ضعاف البصر', DEAF_HARD_OF_HEARING: 'لطلاب صم', SPEECH: 'لطلاب لديهم صعوبات في النطق', NONE: '' },
};

function problemText(e: Evidence, lang: Lang): string {
  const p = e.problem;
  const t = {
    fr: {
      steps: `a ${p.stepCount} marche${p.stepCount > 1 ? 's' : ''}`,
      stairs: 'n’est desservi que par un escalier',
      ramp: p.verified ? `a une rampe à ${p.slopePercent} %` : `a une rampe non vérifiée (${p.slopePercent} %)`,
      narrow: `ne fait que ${p.widthCm} cm de large`,
    },
    en: {
      steps: `has ${p.stepCount} step${p.stepCount > 1 ? 's' : ''}`,
      stairs: 'is only served by stairs',
      ramp: p.verified ? `has a ${p.slopePercent} % ramp` : `has an unverified ramp (${p.slopePercent} %)`,
      narrow: `is only ${p.widthCm} cm wide`,
    },
    ar: {
      steps: `فيه ${p.stepCount} درجات`,
      stairs: 'لا يُوصَل إليه إلا بالدرج',
      ramp: p.verified ? `فيه منحدر بميل ${p.slopePercent}٪` : `فيه منحدر غير مُتحقَّق منه (${p.slopePercent}٪)`,
      narrow: `عرضه ${p.widthCm} سم فقط`,
    },
  }[lang];
  if (e.kind === 'ELEVATOR') return t.stairs;
  if (e.kind === 'WIDEN_DOOR') return t.narrow;
  if (p.stepCount > 0) return t.steps;
  return t.ramp;
}

/** Plain-language rationale, e.g. "82 wheelchair trips/week take a 140 m detour because … has 3 steps". */
export function rationale(e: Evidence, lang: Lang): string {
  const cat = CATEGORY[lang][e.category];
  const n = Math.round(e.passesPerWeek);
  const d = Math.round(e.detourM);
  if (e.kind === 'SIGNAGE') {
    // "detour" here is a fixed estimate of distance lost to hesitation, not measured: say what was observed instead.
    return {
      fr: `${n} trajets ${cat}/semaine passent par ${e.place} et ${e.ratePct} % s’y désorientent (arrêts, demi-tours).`,
      en: `${n} ${cat} trips/week pass ${e.place} and ${e.ratePct} % lose their way there (stops, U-turns).`,
      ar: `${n} رحلة ${cat} أسبوعيًا تمر عبر ${e.place} و${e.ratePct}٪ منها تفقد الاتجاه هناك (توقفات، رجوع).`,
    }[lang];
  }
  const problem = problemText(e, lang);
  if (e.noAlternative) {
    return {
      fr: `${n} trajets ${cat}/semaine n’ont aucun itinéraire sans marche car ${e.place} ${problem} (${e.ratePct} % s’y retrouvent bloqués).`,
      en: `${n} ${cat} trips/week have no step-free route because ${e.place} ${problem} (${e.ratePct} % get stuck or blocked there).`,
      ar: `${n} رحلة ${cat} أسبوعيًا ليس لها مسار بدون درج لأن ${e.place} ${problem} (${e.ratePct}٪ يتعثرون هناك).`,
    }[lang];
  }
  return {
    fr: `${n} trajets ${cat}/semaine font un détour de ${d} m car ${e.place} ${problem} (${e.ratePct} % s’y retrouvent bloqués).`,
    en: `${n} ${cat} trips/week take a ${d} m detour because ${e.place} ${problem} (${e.ratePct} % get stuck or blocked there).`,
    ar: `${n} رحلة ${cat} أسبوعيًا تقطع مسافة إضافية قدرها ${d} م لأن ${e.place} ${problem} (${e.ratePct}٪ يتعثرون هناك).`,
  }[lang];
}

export function title(e: Evidence, lang: Lang): string {
  const t: Record<Lang, Record<RecommendationKind, string>> = {
    fr: { RAMP: 'Rampe', ELEVATOR: 'Ascenseur', WIDEN_DOOR: 'Élargir le passage', ACCESSIBLE_ENTRANCE: 'Entrée accessible', SIGNAGE: 'Signalétique et repères tactiles' },
    en: { RAMP: 'Ramp', ELEVATOR: 'Elevator', WIDEN_DOOR: 'Widen the passage', ACCESSIBLE_ENTRANCE: 'Accessible entrance', SIGNAGE: 'Signage and tactile cues' },
    ar: { RAMP: 'منحدر', ELEVATOR: 'مصعد', WIDEN_DOOR: 'توسيع الممر', ACCESSIBLE_ENTRANCE: 'مدخل مهيأ', SIGNAGE: 'لافتات وعلامات لمسية' },
  };
  return `${t[lang][e.kind]} : ${e.place}`.replace(' : ', lang === 'fr' ? ' : ' : ': ');
}

// ───────────── engine ─────────────

async function passesNear(edgeId: string, since: Date): Promise<{ mobility: MobilityProfile; sessions: number; contributors: number }[]> {
  return prisma.$queryRaw`
    SELECT s.mobility, count(DISTINCT s.id)::int AS sessions, count(DISTINCT s."pseudoId")::int AS contributors
    FROM nav_edges e
    JOIN nav_nodes a ON a.id = e."fromId" JOIN nav_nodes b ON b.id = e."toId"
    JOIN track_points tp ON tp.level IN (a.level, b.level) AND ST_DWithin(tp.geom, e.geom, ${PASS_RADIUS_M})
    JOIN tracking_sessions s ON s.id = tp."sessionId"
    WHERE e.id = ${edgeId} AND tp."recordedAt" >= ${since} AND s.mobility <> 'NONE'
    GROUP BY s.mobility`;
}

async function affectedSessions(edgeId: string, h: HotspotRow, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(DISTINCT e."sessionId")::int AS n
    FROM difficulty_events e JOIN tracking_sessions s ON s.id = e."sessionId"
    WHERE e."recordedAt" >= ${since} AND s.mobility <> 'NONE'
      AND e.type IN ('STUCK', 'BLOCKED', 'TOO_STEEP', 'REROUTED', 'HARD_TO_NAVIGATE')
      AND (e."edgeId" = ${edgeId} OR (e.level = ${h.level} AND ST_DWithin(e.geom, ST_MakePoint(${h.x}, ${h.y}), ${h.radiusM + 4})))`;
  return rows[0]?.n ?? 0;
}

/** Step-free detour around one passage, through the routing engine adapter. */
export function detourAround(graph: CampusGraph, edge: RoutingEdge): { detourM: number; noAlternative: boolean } {
  const constraints = mergeConstraints(null, { avoidStairs: true, maxSlopePercent: 8, minDoorWidthCm: 80, avoidEdgeIds: [edge.id] });
  const path = findPath(graph, edge.fromId, edge.toId, constraints);
  if (!path) return { detourM: NO_ALTERNATIVE_DETOUR_M, noAlternative: true };
  const length = path.edgeIds.reduce((sum, id) => sum + graph.edgeById.get(id)!.lengthM, 0);
  return { detourM: Math.max(0, Math.round(length - edge.lengthM)), noAlternative: false };
}

export async function recomputeRecommendations(hotspots: readonly HotspotRow[], graph: CampusGraph, now: Date): Promise<number> {
  const since = periodWindow('30D', now).start;
  const firstSession = await prisma.trackingSession.findFirst({ where: { startedAt: { gte: since } }, orderBy: { startedAt: 'asc' }, select: { startedAt: true } });
  const observedDays = Math.max(1, Math.min(30, firstSession ? (now.getTime() - firstSession.startedAt.getTime()) / 86_400_000 : 30));

  const best = new Map<string, { evidence: Evidence; h: HotspotRow; edge: RoutingEdge }>();
  for (const h of hotspots) {
    const edge = h.edgeId ? graph.edgeById.get(h.edgeId) : undefined;
    if (!edge || h.contributorCount < K_MIN) continue;

    const passes = await passesNear(edge.id, since);
    const contributors = passes.reduce((s, p) => s + p.contributors, 0);
    const passes30d = passes.reduce((s, p) => s + p.sessions, 0);
    if (contributors < K_MIN || passes30d === 0) continue;

    const dominantCategory = [...passes].sort((a, b) => b.sessions - a.sessions)[0]!;
    const { detourM: rawDetour, noAlternative } = detourAround(graph, edge);
    const kind = kindFor(graph, edge, h.dominantType, noAlternative, dominantCategory.mobility);
    if (!kind) continue;
    const detourM = kind === 'SIGNAGE' ? SIGNAGE_WASTED_M : rawDetour;
    const affected = await affectedSessions(edge.id, h, since);
    const rate = Math.min(1, affected / passes30d);
    const passesPerWeek = Math.round(((dominantCategory.sessions * 7) / observedDays) * 10) / 10;
    const impact = Math.round(((passes30d * 7) / observedDays) * rate * detourM);
    const a = graph.nodes.get(edge.fromId)!;
    const b = graph.nodes.get(edge.toId)!;

    const evidence: Evidence = {
      kind,
      place: describeEdge(graph, edge),
      category: dominantCategory.mobility,
      passesPerWeek,
      passes30d,
      contributors,
      affectedSessions: affected,
      ratePct: Math.round(rate * 100),
      directM: Math.round(edge.lengthM),
      detourM,
      noAlternative,
      impact,
      problem: {
        stepCount: edge.stepCount,
        slopePercent: edge.slopePercent,
        verified: edge.verified,
        widthCm: Math.min(edge.widthCm, edge.doorClearanceCm ?? Infinity),
        vertical: a.level !== b.level,
      },
      hotspotEvents: h.eventCount,
      byType: h.byType as Record<string, number>,
    };
    const key = `${kind}:${edge.id}`;
    const previous = best.get(key);
    if (!previous || previous.evidence.impact < impact) best.set(key, { evidence, h, edge });
  }

  for (const [key, { evidence, h, edge }] of best) {
    const data = {
      kind: evidence.kind,
      title: title(evidence, 'fr'),
      rationale: rationale(evidence, 'fr'),
      score: scoreOf(evidence.impact),
      evidence: evidence as unknown as Prisma.InputJsonValue,
      level: h.level,
      edgeId: edge.id,
      x: h.x,
      y: h.y,
    };
    const row = await prisma.recommendation.upsert({ where: { key }, create: { key, ...data }, update: data });
    bus.emit('admin.recommendation', { id: row.id, status: row.status });
  }
  // Open engine recommendations without evidence any more are withdrawn; admin decisions are kept.
  await prisma.recommendation.deleteMany({ where: { status: 'OPEN', key: { not: null, notIn: [...best.keys()] } } });
  return best.size;
}
