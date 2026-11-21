/**
 * Where the user is. One store, several providers:
 *   qr          a QR checkpoint (printed by doors and elevators; ±1 m)
 *   manual      "I'm here" at a room or place (±5 m) or a point picked on the plan (±3 m)
 *   simulator   demo: walks along the route
 *   geolocation placeholder for future indoor positioning (BLE beacons / Wi-Fi RTT);
 *               works outdoors today only if a campus georeference is configured
 * The position is kept in memory only (never stored on the device).
 */
import { create } from 'zustand';
import type { Track } from './routeModel';
import { positionAt } from './routeModel';

export type PositionSource = 'qr' | 'manual' | 'map' | 'simulator' | 'geolocation';

export type Position = {
  x: number;
  y: number;
  level: number;
  floorId: string | null;
  accuracyM: number;
  source: PositionSource;
  /** Human label: room / place name, or null for a bare point. */
  label: string | null;
  at: number;
};

export const SOURCE_ACCURACY: Record<Exclude<PositionSource, 'geolocation'>, number> = { qr: 1, manual: 5, map: 3, simulator: 1 };

type PositionState = {
  position: Position | null;
  set: (p: Omit<Position, 'at'> & { at?: number }) => void;
  clear: () => void;
};

export const usePosition = create<PositionState>()((set) => ({
  position: null,
  set: (p) => set({ position: { ...p, at: p.at ?? Date.now() } }),
  clear: () => set({ position: null }),
}));

// ───────────── QR checkpoints ─────────────

export type Checkpoint = { kind: 'room' | 'poi'; id: string };

/**
 * QR checkpoints encode a link that opens the app at that spot:
 *   https://<campus>/navigate?at=poi:<id>   or   ...?at=room:A-104
 * Typing the room code from the door sign ("A-104", "a104") also works.
 */
export function parseCheckpoint(raw: string): Checkpoint | null {
  const text = raw.trim();
  if (!text) return null;
  let value = text;
  // Only web links: "room:A-104" would otherwise parse as a URL with a "room:" scheme.
  if (/^https?:\/\//i.test(text)) {
    try {
      value = new URL(text).searchParams.get('at') ?? '';
    } catch {
      return null;
    }
  }
  const m = /^(room|poi):(.+)$/i.exec(value);
  if (m) return { kind: m[1]!.toLowerCase() as 'room' | 'poi', id: m[2]!.trim() };
  if (/^[\p{L}]{1,4}-?[\p{L}\d]{1,6}$/u.test(value)) return { kind: 'room', id: value };
  return null;
}

/** Codes compared without case or separators: "a104" = "A-104". */
export const sameCode = (a: string, b: string): boolean => a.replace(/[^\p{L}\d]/gu, '').toLowerCase() === b.replace(/[^\p{L}\d]/gu, '').toLowerCase();

// ───────────── demo simulator ─────────────

export const SIM_SPEEDS = [1, 2, 4] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

/** Seconds per ride, whatever the number of floors (doors, waiting): elevators are slower. */
const RIDE_S = { ELEVATOR: 12, STAIRS: 8 } as const;

/**
 * Moves along a track at walking (1.2 m/s) or wheelchair (1 m/s) speed, ×1/×2/×4.
 * Elevator and stair rides take a fixed time. tick() is driven by the caller's timer.
 */
export class Simulator {
  d = 0;
  constructor(
    private track: Track,
    private speedMs: number,
  ) {}

  setTrack(track: Track, d = 0): void {
    this.track = track;
    this.d = d;
  }

  get done(): boolean {
    return this.d >= this.track.total;
  }

  /** Advances by dt seconds; returns the new position. */
  tick(dtS: number, factor: number): Omit<Position, 'at'> {
    const pts = this.track.points;
    const i = pts.findIndex((p, k) => k > 0 && p.d > this.d);
    const seg = i > 0 ? pts[i] : undefined;
    const rate = seg?.vertical ? (seg.d - pts[i - 1]!.d) / RIDE_S[seg.vertical] : this.speedMs;
    this.d = Math.min(this.track.total, this.d + rate * dtS * factor);
    return this.position();
  }

  position(): Omit<Position, 'at'> {
    const p = positionAt(this.track, this.d);
    return { x: p.x, y: p.y, level: p.level, floorId: p.floorId, accuracyM: SOURCE_ACCURACY.simulator, source: 'simulator', label: null };
  }

  /** A wrong turn for demos: ~12 m sideways from the current segment (same floor). */
  wrongTurn(): Omit<Position, 'at'> {
    const here = positionAt(this.track, this.d);
    // Direction of travel: look ahead (a stair / elevator ride has none), else behind.
    let dx = 0;
    let dy = 0;
    for (const step of [2, 5, 10, 20, -2, -5, -10]) {
      const other = positionAt(this.track, Math.max(0, Math.min(this.track.total, this.d + step)));
      if (Math.hypot(other.x - here.x, other.y - here.y) > 0.5) {
        dx = (other.x - here.x) * Math.sign(step);
        dy = (other.y - here.y) * Math.sign(step);
        break;
      }
    }
    if (dx === 0 && dy === 0) dx = 1;
    const len = Math.hypot(dx, dy);
    return { x: here.x - (dy / len) * 12, y: here.y + (dx / len) * 12, level: here.level, floorId: here.floorId, accuracyM: SOURCE_ACCURACY.simulator, source: 'simulator', label: null };
  }
}

// ───────────── geolocation placeholder ─────────────

/**
 * Georeference of the campus grid: origin (x = 0, y = 0) in WGS84 and the grid's
 * rotation from true north. VITE_CAMPUS_GEOREF="lat,lng,rotationDeg". Unset → unavailable.
 */
export function campusGeoref(raw: string | undefined = import.meta.env.VITE_CAMPUS_GEOREF as string | undefined): { lat: number; lng: number; rotationDeg: number } | null {
  if (!raw) return null;
  const [lat, lng, rot] = raw.split(',').map(Number);
  if (![lat, lng].every((n) => Number.isFinite(n))) return null;
  return { lat: lat!, lng: lng!, rotationDeg: Number.isFinite(rot) ? rot! : 0 };
}

/** WGS84 → campus metres (equirectangular; fine over a campus). */
export function toCampusXY(lat: number, lng: number, ref: { lat: number; lng: number; rotationDeg: number }): { x: number; y: number } {
  const east = (lng - ref.lng) * Math.cos((ref.lat * Math.PI) / 180) * 111_320;
  const north = (lat - ref.lat) * 110_540;
  const r = (-ref.rotationDeg * Math.PI) / 180;
  return { x: east * Math.cos(r) - north * Math.sin(r), y: east * Math.sin(r) + north * Math.cos(r) };
}

export type GeoStatus = 'unsupported' | 'notConfigured' | 'available';

export function geolocationStatus(): GeoStatus {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'unsupported';
  return campusGeoref() ? 'available' : 'notConfigured';
}

/** Outdoor fixes only (GPS has no floors): level 0, outdoors. Returns a stop function. */
export function watchGeolocation(onFix: (p: Omit<Position, 'at'>) => void, onError: (code: number) => void): () => void {
  const ref = campusGeoref();
  if (!ref || !navigator.geolocation) return () => undefined;
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const { x, y } = toCampusXY(pos.coords.latitude, pos.coords.longitude, ref);
      onFix({ x, y, level: 0, floorId: null, accuracyM: Math.round(pos.coords.accuracy), source: 'geolocation', label: null });
    },
    (err) => onError(err.code),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
