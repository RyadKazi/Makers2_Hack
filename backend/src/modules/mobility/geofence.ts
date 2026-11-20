import { prisma } from '../../lib/prisma.js';

/** For each point, whether it is inside the campus geofence (PostGIS ST_Covers, boundary counts as inside). */
export async function insideGeofence(points: readonly { x: number; y: number }[]): Promise<boolean[]> {
  if (points.length === 0) return [];
  const rows = await prisma.$queryRaw<{ i: number; inside: boolean }[]>`
    SELECT t.i::int AS i, COALESCE(bool_or(ST_Covers(c.geofence, ST_MakePoint(t.x, t.y))), false) AS inside
    FROM unnest(${points.map((p) => p.x)}::float8[], ${points.map((p) => p.y)}::float8[]) WITH ORDINALITY AS t(x, y, i)
    LEFT JOIN campuses c ON c.geofence IS NOT NULL
    GROUP BY t.i
    ORDER BY t.i`;
  return rows.map((r) => r.inside);
}
