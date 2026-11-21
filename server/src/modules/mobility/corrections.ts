/**
 * Map-correction proposals from hotspots. Proposals are PENDING and are NEVER
 * applied automatically: an administrator approves (applies) or rejects them.
 */
import type { CorrectionKind, Prisma } from '@prisma/client';
import { bus } from '../../lib/events.js';
import { prisma } from '../../lib/prisma.js';
import type { CampusGraph, RoutingEdge } from '../routing/graph.repository.js';
import { describeEdge } from '../routing/planner.js';
import type { HotspotRow } from './hotspots.js';

const WALL_FR: Record<string, string> = {
  WALL: 'le mur',
  GLASS: 'la paroi vitrée',
  RAILING: 'la main courante',
  CURB: 'la bordure du trottoir',
  GRASS_EDGE: 'la bordure de pelouse',
};

const narrow = (e: RoutingEdge): boolean => Math.min(e.widthCm, e.doorClearanceCm ?? Infinity) < 80;

type Proposal = { kind: CorrectionKind; title: string; description: string; proposed: Prisma.InputJsonValue | null };

export function proposalFor(h: HotspotRow, graph: CampusGraph): Proposal {
  const edge = h.edgeId ? graph.edgeById.get(h.edgeId) : undefined;
  const n = h.contributorCount;
  const evidence = `${h.eventCount} signalements de ${n} contributeurs (30 jours).`;
  if (!edge) {
    return { kind: 'OTHER', title: 'Zone difficile hors passage cartographié', description: `${evidence} Aucun passage du plan à moins de 8 m : vérifier sur place.`, proposed: null };
  }
  const place = describeEdge(graph, edge);
  const obstacle = edge.hasStairs || narrow(edge) || (edge.isRamp && edge.slopePercent > 8);
  const shoreline =
    h.wallId && h.wallSide
      ? { wallSide: h.wallSide, wallDistanceM: h.wallDistanceM, shorelineHint: `Repère : ${WALL_FR[h.wallKind ?? 'WALL']} (à ${h.wallDistanceM} m du passage)` }
      : null;

  switch (h.dominantType) {
    case 'TOO_STEEP':
      return {
        kind: 'SLOPE',
        title: `Pente signalée trop forte : ${place}`,
        description: `${evidence} Pente actuelle au plan : ${edge.slopePercent} %. À mesurer ; d’ici là, marquer comme non vérifiée.`,
        proposed: { slopePercent: Math.max(edge.slopePercent, 10), verified: false },
      };
    case 'BLOCKED':
    case 'STUCK':
    case 'REROUTED':
      if (edge.hasStairs) {
        return { kind: 'MISSING_FEATURE', title: `Accès sans marche manquant : ${place}`, description: `${evidence} ${edge.stepCount} marche(s) sans alternative proche. Voir les recommandations.`, proposed: null };
      }
      if (narrow(edge)) {
        return {
          kind: 'WIDTH',
          title: `Passage trop étroit : ${place}`,
          description: `${evidence} Largeur au plan : ${Math.min(edge.widthCm, edge.doorClearanceCm ?? Infinity)} cm. À mesurer.`,
          proposed: { verified: false },
        };
      }
      if (!obstacle && h.dominantType === 'BLOCKED') {
        return {
          kind: 'EDGE_CLOSED',
          title: `Passage signalé bloqué : ${place}`,
          description: `${evidence} Le plan le considère ouvert.`,
          proposed: { isOpen: false, closedReason: `Signalé bloqué par ${n} contributeurs` },
        };
      }
      break;
    default:
      break;
  }
  if (shoreline) {
    return { kind: 'SHORELINE', title: `Repère de guidage à ajouter : ${place}`, description: `${evidence} Les étudiants s’y désorientent ; ${WALL_FR[h.wallKind ?? 'WALL']} le plus proche peut servir de ligne de guidage.`, proposed: shoreline };
  }
  return { kind: 'MISSING_FEATURE', title: `Zone difficile : ${place}`, description: `${evidence} Aucun repère tactile à proximité.`, proposed: null };
}

/** Creates or refreshes PENDING proposals. Skips what an admin rejected or accepted in the last 30 days. */
export async function proposeCorrections(hotspots: readonly HotspotRow[], graph: CampusGraph, now: Date): Promise<number> {
  let created = 0;
  const recent = new Date(now.getTime() - 30 * 86_400_000);
  for (const h of hotspots) {
    const p = proposalFor(h, graph);
    const existing = await prisma.mapCorrection.findFirst({
      where: {
        kind: p.kind,
        source: 'CROWD',
        ...(h.edgeId ? { edgeId: h.edgeId } : { x: { gte: h.x - 5, lte: h.x + 5 }, y: { gte: h.y - 5, lte: h.y + 5 }, level: h.level }),
        OR: [{ status: 'PENDING' }, { reviewedAt: { gte: recent } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && existing.status !== 'PENDING') continue;
    if (existing) {
      await prisma.mapCorrection.update({ where: { id: existing.id }, data: { evidenceCount: h.contributorCount, description: p.description } });
      continue;
    }
    const row = await prisma.mapCorrection.create({
      data: {
        kind: p.kind,
        source: 'CROWD',
        title: p.title,
        description: p.description,
        edgeId: h.edgeId ?? null,
        level: h.level,
        ...(p.proposed !== null ? { proposed: p.proposed } : {}),
        evidenceCount: h.contributorCount,
        x: h.x,
        y: h.y,
      },
    });
    created += 1;
    bus.emit('admin.correction', { id: row.id, status: row.status, created: true });
  }
  return created;
}
