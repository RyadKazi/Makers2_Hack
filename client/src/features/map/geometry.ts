/** Geometry helpers for GeoJSON in campus metres ([x, y], y north). Pure. */
import type { Geometry } from '@/api/types';

type Ring = [number, number][];

/** Area-weighted centroid of a polygon's outer ring (falls back to the vertex mean). */
export function polygonCentroid(geometry: Geometry | null): { x: number; y: number } | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [x, y] = geometry.coordinates as [number, number];
    return { x, y };
  }
  const ring = (geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.type === 'MultiPolygon' ? (geometry.coordinates[0] as unknown[])[0] : null) as Ring | null;
  if (!ring?.length) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[i + 1]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length;
    return { x: ring.reduce((s, p) => s + p[0], 0) / n, y: ring.reduce((s, p) => s + p[1], 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Top edge (max y) of a polygon at its centroid x: where the callout points. */
export function polygonTop(geometry: Geometry | null): { x: number; y: number } | null {
  const c = polygonCentroid(geometry);
  if (!c || !geometry || geometry.type !== 'Polygon') return c;
  const ring = geometry.coordinates[0] as Ring;
  return { x: c.x, y: Math.max(...ring.map((p) => p[1])) };
}
