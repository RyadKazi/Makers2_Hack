/**
 * Pure builder for the demo campus: buildings, floors, rooms, POIs, the
 * multi-floor navigation graph and walls. No database access — `index.ts`
 * persists it and the tests check the graph.
 *
 * Layout (local metres, x → east, y → north, campus 220 × 150 m):
 *
 *   y=115 ┌──────── Bloc A ────────┐  bridge  ┌──────── Bloc B ─────────┐
 *         │ n1 │ n2 │core│ Bibliothèque│ (L1,   │ Amphi 1 │core│ n3 │ n4 │EL│
 *   y=100 ├════ corridor ═══════════┤ closed)  ├════ corridor ════════════┤ ◄ side entrance (step-free)
 *         │ s1 │ s2 │hall│stairs│ s3 │ s4 │    │ s1 │ s2 │hall│stairs│ s3 │ s4 │
 *   y=85  └────────▲────────┘   ramp 12% ▲    └────────▲ (3 steps) ───────┘
 *                 A entrance (ramp 5 %)   library   B main entrance
 *                        ↖  cour centrale (110,75)  ↗
 *                               esplanade (110,40)  ── service road ── east path
 *                               portail (110,5)          parking PMR (180,20)
 */
import type { GraphEdge } from '../../src/modules/routing/graph.js';

export type XY = readonly [number, number];
export type BuildingCode = 'A' | 'B';
export type NodeKind = 'CORRIDOR' | 'DOOR' | 'ENTRANCE' | 'ELEVATOR' | 'STAIRS' | 'RAMP' | 'JUNCTION' | 'OUTDOOR';
export type Surface = 'TILE' | 'CONCRETE' | 'ASPHALT' | 'PAVERS' | 'GRAVEL' | 'CARPET' | 'METAL';
export type WallSide = 'LEFT' | 'RIGHT' | 'BOTH' | 'NONE';
export type WallKind = 'WALL' | 'GLASS' | 'RAILING' | 'CURB' | 'GRASS_EDGE';
export type RoomType = 'CLASSROOM' | 'LAB' | 'AMPHITHEATER' | 'LIBRARY' | 'OFFICE' | 'MEETING';
export type PoiType =
  | 'ENTRANCE'
  | 'ACCESSIBLE_ENTRANCE'
  | 'ELEVATOR'
  | 'STAIRS'
  | 'RAMP'
  | 'TOILET'
  | 'ACCESSIBLE_TOILET'
  | 'FACILITY'
  | 'PARKING_ACCESSIBLE'
  | 'INFO_DESK';

/** Floors are referenced by key ("A0", "B2"…) until the DB assigns ids. */
export type FloorKey = `${BuildingCode}${0 | 1 | 2}`;

export type SeedBuilding = { code: BuildingCode; name: string; nameAr: string; x: number; y: number; polygon: XY[] };
export type SeedFloor = { key: FloorKey; buildingCode: BuildingCode; level: number; name: string; elevationM: number; polygon: XY[] };
export type SeedNode = {
  id: string;
  floorKey: FloorKey | null;
  level: number;
  kind: NodeKind;
  label: string | null;
  landmark: string | null;
  x: number;
  y: number;
};
export type SeedEdge = GraphEdge & {
  stepCount: number;
  surface: Surface;
  closedReason: string | null;
  wallSide: WallSide;
  wallDistanceM: number | null;
  shorelineHint: string | null;
};
export type SeedRoom = {
  code: string;
  name: string;
  nameAr: string | null;
  type: RoomType;
  capacity: number;
  wheelchairSpaces: number;
  hearingLoop: boolean;
  floorKey: FloorKey;
  x: number;
  y: number;
  polygon: XY[];
  doorNodeId: string;
};
export type SeedPoi = {
  floorKey: FloorKey | null;
  level: number;
  type: PoiType;
  name: string;
  nameAr: string | null;
  accessible: boolean;
  notes: string | null;
  x: number;
  y: number;
  navNodeId: string | null;
};
export type SeedWall = { floorKey: FloorKey | null; level: number; kind: WallKind; label: string | null; line: XY[] };

export type CampusModel = {
  campus: { name: string; nameAr: string; timezone: string; geofence: XY[] };
  buildings: SeedBuilding[];
  floors: SeedFloor[];
  rooms: SeedRoom[];
  pois: SeedPoi[];
  nodes: SeedNode[];
  edges: SeedEdge[];
  walls: SeedWall[];
};

/** Node ids referenced by the mobility generator and tests. */
export const KEY_NODES = {
  gate: 'O-GATE',
  plaza: 'O-PLAZA',
  courtyard: 'O-COUR-N',
  parking: 'O-PARK',
  cafeteria: 'O-CAFE',
  aEntranceOutside: 'O-A-ENT',
  bEntranceOutside: 'O-B-ENT',
  bEntranceDoor: 'B0-ENT',
  bSideOutside: 'O-B-SIDE',
  libraryRampBottom: 'O-BIB-RAMP-BOT',
  libraryLanding: 'O-BIB-LANDING',
  bridgeA: 'A1-C78',
  bridgeB: 'B1-C02',
} as const;

export const KEY_EDGES = {
  bMainEntranceSteps: 'E-O-B-ENT--B0-ENT',
  libraryRamp: 'E-O-BIB-RAMP-BOT--O-BIB-LANDING',
  bridge: 'E-A1-C78--B1-C02',
  bStairs01: 'E-B0-STAIRS--B1-STAIRS',
  bStairs12: 'E-B1-STAIRS--B2-STAIRS',
} as const;

// ───────────────────────── geometry constants ─────────────────────────

const CORRIDOR_Y = 100;
const SOUTH: XY = [85, 98.5];
const NORTH: XY = [101.5, 115];
const LEVELS = [0, 1, 2] as const;
const FLOOR_NAMES = ['Rez-de-chaussée', '1er étage', '2e étage'] as const;

type BuildingSpec = {
  code: BuildingCode;
  name: string;
  nameAr: string;
  x0: number;
  length: number;
  corridorWidthCm: number;
  corridorStops: number[];
  elevatorAt: XY; // relative
  elevatorStop: number; // corridor stop serving the elevator
};

const BUILDINGS: BuildingSpec[] = [
  {
    code: 'A',
    name: 'Bloc A',
    nameAr: 'الجناح أ',
    x0: 20,
    length: 80,
    corridorWidthCm: 240,
    corridorStops: [2, 8, 24, 36, 44, 56, 72, 78],
    elevatorAt: [34.5, 106],
    elevatorStop: 36,
  },
  {
    code: 'B',
    name: 'Bloc B',
    nameAr: 'الجناح ب',
    x0: 120,
    length: 84, // 4 m east extension: elevator shaft + step-free side entrance
    corridorWidthCm: 200,
    corridorStops: [2, 8, 24, 36, 44, 56, 72, 78, 82],
    elevatorAt: [82, 106],
    elevatorStop: 82,
  },
];

type Slot = { side: 'S' | 'N'; idx: number; from: number; to: number; door: number };
const SLOTS: Slot[] = [
  { side: 'S', idx: 1, from: 0, to: 16, door: 8 },
  { side: 'S', idx: 2, from: 16, to: 32, door: 24 },
  { side: 'S', idx: 3, from: 48, to: 64, door: 56 },
  { side: 'S', idx: 4, from: 64, to: 80, door: 72 },
  { side: 'N', idx: 1, from: 0, to: 16, door: 8 },
  { side: 'N', idx: 2, from: 16, to: 32, door: 24 },
  { side: 'N', idx: 3, from: 48, to: 64, door: 56 },
  { side: 'N', idx: 4, from: 64, to: 80, door: 72 },
];

type RoomOverride = Partial<Pick<SeedRoom, 'name' | 'nameAr' | 'type' | 'capacity' | 'wheelchairSpaces' | 'hearingLoop'>> & {
  doorClearanceCm?: number;
};

/** Merged rooms replace two adjacent slots on the same side. */
type MergedRoom = { floorKey: FloorKey; code: string; side: 'S' | 'N'; replaces: [number, number]; from: number; to: number; door: number };
const MERGED: MergedRoom[] = [
  { floorKey: 'A0', code: 'A-BIB', side: 'N', replaces: [3, 4], from: 48, to: 80, door: 56 },
  { floorKey: 'B0', code: 'B-AMPHI1', side: 'N', replaces: [1, 2], from: 0, to: 32, door: 24 },
  { floorKey: 'A2', code: 'A-203', side: 'S', replaces: [3, 4], from: 48, to: 80, door: 56 },
  { floorKey: 'B2', code: 'B-203', side: 'S', replaces: [3, 4], from: 48, to: 80, door: 56 },
];

const ROOM_OVERRIDES: Record<string, RoomOverride> = {
  'A-001': { name: 'Service de scolarité', nameAr: 'مصلحة التمدرس', type: 'OFFICE', capacity: 8 },
  'A-011': { name: 'Bureau du chef de département', type: 'OFFICE', capacity: 4 },
  'A-012': { name: 'Salle de réunion du département', nameAr: 'قاعة الاجتماعات', type: 'MEETING', capacity: 20 },
  'A-BIB': {
    name: 'Bibliothèque centrale',
    nameAr: 'المكتبة المركزية',
    type: 'LIBRARY',
    capacity: 180,
    wheelchairSpaces: 6,
    hearingLoop: true,
    doorClearanceCm: 140,
  },
  'A-102': { name: 'Salle TP électronique A-102', type: 'LAB', capacity: 24, doorClearanceCm: 75 },
  'A-103': { name: 'Salle TP physique A-103', type: 'LAB', capacity: 24 },
  'A-111': { name: 'Bureau Dr. Benali', type: 'OFFICE', capacity: 3 },
  'A-203': { name: 'Laboratoire informatique 1', nameAr: 'مخبر الإعلام الآلي 1', type: 'LAB', capacity: 40, wheelchairSpaces: 2, doorClearanceCm: 120 },
  'B-AMPHI1': {
    name: 'Amphi 1',
    nameAr: 'المدرج 1',
    type: 'AMPHITHEATER',
    capacity: 220,
    wheelchairSpaces: 4,
    hearingLoop: true,
    doorClearanceCm: 160,
  },
  'B-013': { name: 'Foyer des clubs scientifiques', nameAr: 'نادي الطلبة', type: 'MEETING', capacity: 30 },
  'B-104': { doorClearanceCm: 80 },
  'B-112': { name: 'Bureau Mme. Haddad', type: 'OFFICE', capacity: 3 },
  'B-203': { name: 'Laboratoire de robotique', nameAr: 'مخبر الروبوتيك', type: 'LAB', capacity: 30, wheelchairSpaces: 2, doorClearanceCm: 120 },
};

// ───────────────────────── helpers ─────────────────────────

const round = (n: number): number => Math.round(n * 100) / 100;
const dist = (a: XY, b: XY): number => round(Math.hypot(a[0] - b[0], a[1] - b[1]));
const rect = (x1: number, y1: number, x2: number, y2: number): XY[] => [
  [x1, y1],
  [x2, y1],
  [x2, y2],
  [x1, y2],
  [x1, y1],
];

type EdgeOptions = Partial<Omit<SeedEdge, 'id' | 'fromId' | 'toId'>>;

class GraphBuilder {
  readonly nodes = new Map<string, SeedNode>();
  readonly edges: SeedEdge[] = [];

  node(id: string, x: number, y: number, kind: NodeKind, floorKey: FloorKey | null, level: number, label: string | null = null, landmark: string | null = null): string {
    if (this.nodes.has(id)) throw new Error(`Duplicate node ${id}`);
    this.nodes.set(id, { id, floorKey, level, kind, label, landmark, x: round(x), y: round(y) });
    return id;
  }

  edge(fromId: string, toId: string, opts: EdgeOptions = {}): string {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) throw new Error(`Edge ${fromId} → ${toId} references a missing node`);
    const id = `E-${fromId}--${toId}`;
    this.edges.push({
      id,
      fromId,
      toId,
      bidirectional: true,
      lengthM: Math.max(0.5, dist([from.x, from.y], [to.x, to.y])),
      hasStairs: false,
      stepCount: 0,
      isRamp: false,
      slopePercent: 0,
      widthCm: 150,
      doorClearanceCm: null,
      surface: 'TILE',
      isElevator: false,
      isOpen: true,
      closedReason: null,
      verified: true,
      wallSide: 'NONE',
      wallDistanceM: null,
      shorelineHint: null,
      ...opts,
    });
    return id;
  }
}

// ───────────────────────── builder ─────────────────────────

export function buildCampus(): CampusModel {
  const g = new GraphBuilder();
  const buildings: SeedBuilding[] = [];
  const floors: SeedFloor[] = [];
  const rooms: SeedRoom[] = [];
  const pois: SeedPoi[] = [];
  const walls: SeedWall[] = [];

  for (const b of BUILDINGS) {
    const x1 = b.x0;
    const x2 = b.x0 + b.length;
    const footprint = rect(x1, SOUTH[0], x2, NORTH[1]);
    buildings.push({ code: b.code, name: b.name, nameAr: b.nameAr, x: x1 + b.length / 2, y: NORTH[1] + 4, polygon: footprint });

    for (const level of LEVELS) {
      const key = `${b.code}${level}` as FloorKey;
      floors.push({ key, buildingCode: b.code, level, name: FLOOR_NAMES[level], elevationM: level * 4, polygon: footprint });
      const nid = (suffix: string): string => `${key}-${suffix}`;
      const stop = (rel: number): string => nid(`C${String(rel).padStart(2, '0')}`);

      // Corridor spine
      for (const rel of b.corridorStops) {
        const isEnd = rel === b.corridorStops[0] || rel === b.corridorStops.at(-1);
        g.node(stop(rel), b.x0 + rel, CORRIDOR_Y, 'CORRIDOR', key, level, isEnd ? `Bout du couloir ${b.name}` : null);
      }
      b.corridorStops.slice(1).forEach((rel, i) => {
        const prev = b.corridorStops[i]!;
        g.edge(stop(prev), stop(rel), {
          widthCm: b.corridorWidthCm,
          wallSide: 'BOTH',
          wallDistanceM: 1.5,
          shorelineHint: 'Longez le mur du couloir',
        });
      });

      // Rooms (regular slots + merged rooms)
      const merged = MERGED.filter((m) => m.floorKey === key);
      const roomSpecs: { code: string; side: 'S' | 'N'; from: number; to: number; door: number }[] = [];
      for (const slot of SLOTS) {
        if (merged.some((m) => m.side === slot.side && m.replaces.includes(slot.idx))) continue;
        const code = `${b.code}-${level}${slot.side === 'S' ? 0 : 1}${slot.idx}`;
        roomSpecs.push({ code, side: slot.side, from: slot.from, to: slot.to, door: slot.door });
      }
      for (const m of merged) roomSpecs.push({ code: m.code, side: m.side, from: m.from, to: m.to, door: m.door });

      for (const spec of roomSpecs) {
        const o = ROOM_OVERRIDES[spec.code] ?? {};
        const [ya, yb] = spec.side === 'S' ? SOUTH : NORTH;
        const doorY = spec.side === 'S' ? SOUTH[1] : NORTH[0];
        const doorId = g.node(nid(`D-${spec.code}`), b.x0 + spec.door, doorY, 'DOOR', key, level, `Porte ${spec.code}`);
        const clearance = o.doorClearanceCm ?? 90;
        g.edge(stop(spec.door), doorId, { widthCm: clearance, doorClearanceCm: clearance });
        const capacity = o.capacity ?? (o.type === 'LAB' ? 24 : 40);
        rooms.push({
          code: spec.code,
          name: o.name ?? `Salle de TD ${spec.code}`,
          nameAr: o.nameAr ?? null,
          type: o.type ?? 'CLASSROOM',
          capacity,
          wheelchairSpaces: o.wheelchairSpaces ?? (clearance >= 90 ? 1 : 0),
          hearingLoop: o.hearingLoop ?? false,
          floorKey: key,
          x: b.x0 + (spec.from + spec.to) / 2,
          y: (ya + yb) / 2,
          polygon: rect(b.x0 + spec.from, ya, b.x0 + spec.to, yb),
          doorNodeId: doorId,
        });
      }

      // Stairs
      const stairs = g.node(nid('STAIRS'), b.x0 + 44, 92, 'STAIRS', key, level, `Escalier ${b.name}`, "cage d'escalier, contremarches contrastées");
      g.edge(stop(44), stairs, { widthCm: 160 });
      pois.push({ floorKey: key, level, type: 'STAIRS', name: `Escalier ${b.name}`, nameAr: 'درج', accessible: false, notes: null, x: b.x0 + 44, y: 92, navNodeId: stairs });

      // Elevator
      const [ex, ey] = b.elevatorAt;
      const elev = g.node(nid('ELEV'), b.x0 + ex, ey, 'ELEVATOR', key, level, `Ascenseur ${b.name}`, 'ascenseur, boutons en braille, annonce vocale');
      g.edge(stop(b.elevatorStop), elev, { widthCm: 110, doorClearanceCm: 90 });
      pois.push({
        floorKey: key,
        level,
        type: 'ELEVATOR',
        name: `Ascenseur ${b.name}`,
        nameAr: 'مصعد',
        accessible: true,
        notes: b.code === 'B' ? "Au bout du couloir, côté entrée latérale" : 'Face au hall',
        x: b.x0 + ex,
        y: ey,
        navNodeId: elev,
      });

      // Toilets (accessible toilets on every floor in A, ground floor only in B)
      const wcX = b.code === 'A' ? 39.5 : 36;
      const wc = g.node(nid('WC'), b.x0 + wcX, NORTH[0], 'DOOR', key, level, 'Toilettes');
      g.edge(stop(36), wc, { widthCm: 80, doorClearanceCm: 80 });
      pois.push({ floorKey: key, level, type: 'TOILET', name: 'Toilettes', nameAr: 'دورات المياه', accessible: false, notes: null, x: b.x0 + wcX, y: 108, navNodeId: wc });
      if (b.code === 'A' || level === 0) {
        const wcp = g.node(nid('WCPMR'), b.x0 + 45, NORTH[0], 'DOOR', key, level, 'Toilettes accessibles');
        g.edge(stop(44), wcp, { widthCm: 100, doorClearanceCm: 100 });
        pois.push({
          floorKey: key,
          level,
          type: 'ACCESSIBLE_TOILET',
          name: 'Toilettes accessibles (PMR)',
          nameAr: 'دورات مياه مهيأة',
          accessible: true,
          notes: 'Barres d’appui, porte 100 cm',
          x: b.x0 + 45,
          y: 108,
          navNodeId: wcp,
        });
      }

      // Walls: façade, corridor walls, partitions
      const façadeKind: WallKind = level === 0 ? 'GLASS' : 'WALL';
      walls.push({ floorKey: key, level, kind: façadeKind, label: 'Façade sud', line: [[x1, SOUTH[0]], [x2, SOUTH[0]]] });
      walls.push({ floorKey: key, level, kind: 'WALL', label: 'Façade nord', line: [[x1, NORTH[1]], [x2, NORTH[1]]] });
      walls.push({ floorKey: key, level, kind: 'WALL', label: 'Pignon ouest', line: [[x1, SOUTH[0]], [x1, NORTH[1]]] });
      walls.push({ floorKey: key, level, kind: 'WALL', label: 'Pignon est', line: [[x2, SOUTH[0]], [x2, NORTH[1]]] });
      walls.push({ floorKey: key, level, kind: 'WALL', label: 'Mur sud du couloir', line: [[x1, SOUTH[1]], [x2, SOUTH[1]]] });
      walls.push({ floorKey: key, level, kind: 'WALL', label: 'Mur nord du couloir', line: [[x1, NORTH[0]], [x2, NORTH[0]]] });
      for (const rel of [16, 32, 40, 48, 64, 80]) {
        walls.push({ floorKey: key, level, kind: 'WALL', label: null, line: [[b.x0 + rel, SOUTH[0]], [b.x0 + rel, SOUTH[1]]] });
        walls.push({ floorKey: key, level, kind: 'WALL', label: null, line: [[b.x0 + rel, NORTH[0]], [b.x0 + rel, NORTH[1]]] });
      }
    }

    // Vertical links between consecutive floors
    for (const level of [0, 1] as const) {
      const lo = `${b.code}${level}`;
      const hi = `${b.code}${level + 1}`;
      g.edge(`${lo}-STAIRS`, `${hi}-STAIRS`, {
        lengthM: 10,
        hasStairs: true,
        stepCount: 24,
        widthCm: 160,
        wallSide: b.code === 'A' ? 'BOTH' : 'LEFT',
        wallDistanceM: 0.3,
        shorelineHint:
          b.code === 'A'
            ? 'Mains courantes des deux côtés'
            : 'Main courante uniquement à gauche en montant (à droite en descendant)',
      });
      g.edge(`${lo}-ELEV`, `${hi}-ELEV`, { lengthM: 4, isElevator: true, widthCm: 110, doorClearanceCm: 90 });
    }
  }

  // ───────── Entrances ─────────
  const n = g.node.bind(g);
  const e = g.edge.bind(g);

  n('A0-ENT', 56, 85, 'ENTRANCE', 'A0', 0, 'Entrée principale Bloc A', 'double porte vitrée automatique');
  e('A0-ENT', 'A0-C36', { widthCm: 300, wallSide: 'NONE', shorelineHint: 'Hall : avancez tout droit jusqu’au couloir' });
  n('B0-ENT', 156, 85, 'ENTRANCE', 'B0', 0, 'Entrée principale Bloc B', 'porte en bois à deux battants');
  e('B0-ENT', 'B0-C36', { widthCm: 300 });
  n('B0-SIDE', 204, 95, 'ENTRANCE', 'B0', 0, 'Entrée latérale Bloc B (sans marche)', 'porte métallique grise, bouton d’appel');
  e('B0-SIDE', 'B0-C82', { widthCm: 120, doorClearanceCm: 90 });
  n('A0-BIB-EXT', 100, 108, 'ENTRANCE', 'A0', 0, 'Entrée extérieure de la bibliothèque', 'porte vitrée de la bibliothèque');
  e('A0-BIB-EXT', 'A0-D-A-BIB', { lengthM: 26, widthCm: 120, doorClearanceCm: 90, shorelineHint: 'Traversez la salle de lecture le long des rayonnages à gauche', wallSide: 'LEFT', wallDistanceM: 1 });

  // ───────── Outdoor network ─────────
  n('O-GATE', 110, 5, 'ENTRANCE', null, 0, 'Portail principal', 'portail principal, guérite de l’agent de sécurité');
  n('O-PLAZA', 110, 40, 'JUNCTION', null, 0, 'Esplanade', 'fontaine de l’esplanade');
  n('O-COUR-N', 110, 75, 'JUNCTION', null, 0, 'Cour centrale', 'mât du drapeau');
  n('O-A-ENT', 56, 80, 'OUTDOOR', null, 0, 'Parvis du Bloc A', 'bas de la rampe du Bloc A');
  n('O-B-ENT', 156, 80, 'OUTDOOR', null, 0, 'Parvis du Bloc B', 'perron de trois marches');
  n('O-EAST', 210, 40, 'JUNCTION', null, 0, 'Route de service', null);
  n('O-EAST-N', 210, 80, 'JUNCTION', null, 0, 'Angle sud-est du Bloc B', 'poteau d’éclairage');
  n('O-B-SIDE', 210, 95, 'OUTDOOR', null, 0, 'Devant l’entrée latérale du Bloc B', null);
  n('O-PARK', 180, 20, 'OUTDOOR', null, 0, 'Parking PMR', 'places bleues');
  n('O-CAFE', 40, 40, 'OUTDOOR', null, 0, 'Cafétéria', 'terrasse de la cafétéria');
  n('O-BIB-RAMP-BOT', 112, 92, 'RAMP', null, 0, 'Bas de la rampe de la bibliothèque', null);
  n('O-BIB-LANDING', 106, 108, 'RAMP', null, 0, 'Palier de la bibliothèque', null);

  const paved = { surface: 'PAVERS' as const, widthCm: 300 };
  e('O-GATE', 'O-PLAZA', { ...paved, widthCm: 400, wallSide: 'BOTH', wallDistanceM: 2, shorelineHint: 'Suivez la bordure du trottoir' });
  e('O-PLAZA', 'O-COUR-N', { ...paved, wallSide: 'RIGHT', wallDistanceM: 1.5, shorelineHint: 'Bordure de pelouse à droite' });
  e('O-COUR-N', 'O-A-ENT', { ...paved, wallSide: 'RIGHT', wallDistanceM: 1.5, shorelineHint: 'Bordure de pelouse à droite' });
  e('O-COUR-N', 'O-B-ENT', { ...paved, wallSide: 'LEFT', wallDistanceM: 1.5, shorelineHint: 'Bordure de pelouse à gauche' });
  e('O-B-ENT', 'O-EAST-N', { ...paved, widthCm: 200, wallSide: 'LEFT', wallDistanceM: 5, shorelineHint: 'Longez la façade du Bloc B à gauche' });
  e('O-EAST-N', 'O-B-SIDE', { surface: 'CONCRETE', widthCm: 200, wallSide: 'LEFT', wallDistanceM: 6 });
  e('O-PLAZA', 'O-EAST', { surface: 'ASPHALT', widthCm: 500, wallSide: 'RIGHT', wallDistanceM: 0.5, shorelineHint: 'Bordure de trottoir à droite' });
  e('O-EAST', 'O-EAST-N', { surface: 'ASPHALT', widthCm: 300, wallSide: 'LEFT', wallDistanceM: 0.5, shorelineHint: 'Bordure de trottoir à gauche' });
  e('O-PARK', 'O-EAST', { surface: 'ASPHALT', widthCm: 300 });
  e('O-PARK', 'O-PLAZA', { surface: 'ASPHALT', widthCm: 300, wallSide: 'RIGHT', wallDistanceM: 0.5 });
  e('O-PLAZA', 'O-CAFE', { ...paved, wallSide: 'LEFT', wallDistanceM: 1, shorelineHint: 'Muret de la cafétéria à gauche' });
  // Gravel shortcut: tempting but not step-free friendly
  e('O-CAFE', 'O-A-ENT', { surface: 'GRAVEL', widthCm: 120, slopePercent: 9, verified: false });

  // Entrance thresholds
  e('O-A-ENT', 'A0-ENT', {
    isRamp: true,
    slopePercent: 5,
    widthCm: 180,
    doorClearanceCm: 160,
    surface: 'CONCRETE',
    wallSide: 'RIGHT',
    wallDistanceM: 0.2,
    shorelineHint: 'Rampe douce, main courante à droite',
  });
  e('O-B-ENT', 'B0-ENT', { hasStairs: true, stepCount: 3, widthCm: 300, doorClearanceCm: 180, surface: 'CONCRETE', wallSide: 'BOTH', wallDistanceM: 0.3, shorelineHint: 'Trois marches, rampes de chaque côté' });
  e('O-B-SIDE', 'B0-SIDE', { isRamp: true, slopePercent: 3, widthCm: 150, doorClearanceCm: 90, surface: 'CONCRETE' });

  // Library ramp: too steep (≈12 %) and never verified — the crowd hotspot
  e('O-COUR-N', 'O-BIB-RAMP-BOT', { ...paved, widthCm: 200 });
  e('O-BIB-RAMP-BOT', 'O-BIB-LANDING', {
    isRamp: true,
    slopePercent: 12,
    widthCm: 110,
    surface: 'CONCRETE',
    verified: false,
    wallSide: 'LEFT',
    wallDistanceM: 0.2,
    shorelineHint: 'Rampe raide, main courante à gauche en montant',
  });
  e('O-BIB-LANDING', 'A0-BIB-EXT', { widthCm: 150, doorClearanceCm: 90, surface: 'CONCRETE' });

  // Level-1 footbridge between the blocks: closed for works
  e('A1-C78', 'B1-C02', {
    widthCm: 200,
    surface: 'METAL',
    isOpen: false,
    closedReason: 'Passerelle fermée : travaux d’étanchéité',
    wallSide: 'BOTH',
    wallDistanceM: 1,
    shorelineHint: 'Garde-corps des deux côtés',
  });

  // ───────── Outdoor POIs & walls ─────────
  pois.push(
    { floorKey: null, level: 0, type: 'ENTRANCE', name: 'Portail principal', nameAr: 'المدخل الرئيسي', accessible: true, notes: null, x: 110, y: 5, navNodeId: 'O-GATE' },
    { floorKey: 'A0', level: 0, type: 'ENTRANCE', name: 'Entrée principale Bloc A', nameAr: 'مدخل الجناح أ', accessible: true, notes: 'Rampe 5 % vérifiée, porte automatique', x: 56, y: 85, navNodeId: 'A0-ENT' },
    { floorKey: 'B0', level: 0, type: 'ENTRANCE', name: 'Entrée principale Bloc B', nameAr: 'مدخل الجناح ب', accessible: false, notes: 'Trois marches, pas de rampe', x: 156, y: 85, navNodeId: 'B0-ENT' },
    { floorKey: 'B0', level: 0, type: 'ACCESSIBLE_ENTRANCE', name: 'Entrée latérale Bloc B (sans marche)', nameAr: 'مدخل جانبي مهيأ', accessible: true, notes: 'Côté est, près de l’ascenseur', x: 204, y: 95, navNodeId: 'B0-SIDE' },
    { floorKey: 'A0', level: 0, type: 'ENTRANCE', name: 'Entrée extérieure de la bibliothèque', nameAr: 'مدخل المكتبة', accessible: false, notes: 'Accès par une rampe trop raide (~12 %)', x: 100, y: 108, navNodeId: 'A0-BIB-EXT' },
    { floorKey: null, level: 0, type: 'RAMP', name: 'Rampe du Bloc A', nameAr: 'منحدر', accessible: true, notes: 'Pente 5 %, vérifiée', x: 56, y: 82.5, navNodeId: 'O-A-ENT' },
    { floorKey: null, level: 0, type: 'RAMP', name: 'Rampe de la bibliothèque', nameAr: 'منحدر المكتبة', accessible: false, notes: 'Pente ≈ 12 %, non conforme', x: 109, y: 100, navNodeId: 'O-BIB-RAMP-BOT' },
    { floorKey: null, level: 0, type: 'PARKING_ACCESSIBLE', name: 'Parking PMR', nameAr: 'موقف ذوي الاحتياجات الخاصة', accessible: true, notes: '4 places', x: 180, y: 20, navNodeId: 'O-PARK' },
    { floorKey: null, level: 0, type: 'FACILITY', name: 'Cafétéria', nameAr: 'الكافيتيريا', accessible: true, notes: null, x: 40, y: 40, navNodeId: 'O-CAFE' },
    { floorKey: 'A0', level: 0, type: 'INFO_DESK', name: 'Accueil / information', nameAr: 'الاستقبال', accessible: true, notes: 'Boucle magnétique au comptoir', x: 56, y: 92, navNodeId: 'A0-ENT' },
    { floorKey: 'A0', level: 0, type: 'FACILITY', name: 'Salle de prière', nameAr: 'مصلى', accessible: true, notes: null, x: 22, y: 100, navNodeId: 'A0-C02' },
    { floorKey: 'A1', level: 1, type: 'FACILITY', name: 'Photocopie', nameAr: 'نسخ الوثائق', accessible: true, notes: null, x: 98, y: 100, navNodeId: 'A1-C78' },
    { floorKey: 'B0', level: 0, type: 'FACILITY', name: 'Infirmerie', nameAr: 'العيادة', accessible: true, notes: 'Ouverte 8h–16h', x: 198, y: 100, navNodeId: 'B0-C78' },
  );

  walls.push(
    { floorKey: null, level: 0, kind: 'CURB', label: 'Bordure allée principale (ouest)', line: [[108, 5], [108, 40]] },
    { floorKey: null, level: 0, kind: 'CURB', label: 'Bordure allée principale (est)', line: [[112, 5], [112, 40]] },
    { floorKey: null, level: 0, kind: 'GRASS_EDGE', label: 'Pelouse centrale', line: [[111.5, 40], [111.5, 75]] },
    { floorKey: null, level: 0, kind: 'CURB', label: 'Bordure route de service', line: [[110, 38.5], [210, 38.5]] },
    { floorKey: null, level: 0, kind: 'RAILING', label: 'Main courante rampe Bloc A', line: [[57, 80], [57, 85]] },
    { floorKey: null, level: 0, kind: 'RAILING', label: 'Main courante rampe bibliothèque', line: [[111, 92], [105, 108]] },
    { floorKey: 'A1', level: 1, kind: 'RAILING', label: 'Garde-corps passerelle (nord)', line: [[100, 101], [120, 101]] },
    { floorKey: 'A1', level: 1, kind: 'RAILING', label: 'Garde-corps passerelle (sud)', line: [[100, 99], [120, 99]] },
  );

  return {
    campus: {
      name: 'Université de démonstration — Campus principal',
      nameAr: 'الجامعة — الحرم الرئيسي',
      timezone: 'Africa/Algiers',
      geofence: rect(0, 0, 220, 150),
    },
    buildings,
    floors,
    rooms,
    pois,
    nodes: [...g.nodes.values()],
    edges: g.edges,
    walls,
  };
}

/** WKT helpers for raw PostGIS inserts. */
export const toWktPolygon = (ring: readonly XY[]): string => `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(', ')}))`;
export const toWktLine = (line: readonly XY[]): string => `LINESTRING(${line.map(([x, y]) => `${x} ${y}`).join(', ')})`;
