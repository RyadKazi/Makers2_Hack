import {
  Bookmark,
  Building2,
  Download,
  FileCode,
  Layers,
  Maximize2,
  Minus,
  Navigation,
  Plus,
  RotateCcw,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBuildings, useFloorPlan, useFloorSvg, useRooms } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { useMapPrefs } from '@/stores/mapPrefs';
import type { Lang } from '@/stores/preferences';
import { FloorMap, type MapItem } from './FloorMap';

export interface IsometricBuildingData {
  id: string;
  code: string;
  name: string;
  nameAr?: string;
  category: string;
  categoryTag: string;
  rating: number;
  description: string;
  descriptionAr: string;
  isoX: number;
  isoY: number;
  width: number;
  depth: number;
  height: number;
  accentColor: string;
  labelOffsetY: number;
  image: string;
}

const ISO_BUILDINGS: IsometricBuildingData[] = [
  {
    id: 'building-resto',
    code: 'RESTO',
    name: 'Restaurant Universitaire & Café',
    nameAr: 'المطعم الجامعي والمقهى',
    category: 'RESTAURATION',
    categoryTag: 'RESTAURANTE / CAFÉ',
    rating: 4.6,
    description: 'Espace restauration, cafétéria étudiante et terrasse arborée.',
    descriptionAr: 'فضاء الإطعام والمقهى الطلابي مع شرفة مشجرة.',
    isoX: 180,
    isoY: 230,
    width: 95,
    depth: 75,
    height: 48,
    accentColor: 'rgb(var(--c-primary))',
    labelOffsetY: 70,
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&auto=format&fit=crop&q=80',
  },
  {
    id: 'building-b',
    code: 'B',
    name: 'Bâtiment B (Amphithéâtres & Cours)',
    nameAr: 'المبنى ب (المدرجات وقاعات التدريس)',
    category: 'AMPHITHÉÂTRES & ENSEIGNEMENT',
    categoryTag: 'COURS',
    rating: 4.8,
    description: 'Grands amphithéâtres A et B, salles de travaux dirigés et bureaux pédagogiques.',
    descriptionAr: 'المدرجات الكبرى وقاعات الأعمال الموجهة والمكاتب البيداغوجية.',
    isoX: 740,
    isoY: 170,
    width: 145,
    depth: 115,
    height: 72,
    accentColor: 'rgb(var(--c-primary))',
    labelOffsetY: 100,
    image: 'https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=600&auto=format&fit=crop&q=80',
  },
  {
    id: 'building-a',
    code: 'A',
    name: 'Bâtiment A (Sciences & Informatique)',
    nameAr: 'المبنى أ (العلوم والإعلام الآلي)',
    category: 'FACULTÉ DES SCIENCES',
    categoryTag: 'UNIVERSITÉ',
    rating: 4.9,
    description: 'Pôle informatique, intelligence artificielle, laboratoires de recherche et bibliothèque centrale.',
    descriptionAr: 'قطب الإعلام الآلي والذكاء الاصطناعي والمخابر والمكتبة المركزية.',
    isoX: 380,
    isoY: 380,
    width: 135,
    depth: 105,
    height: 85,
    accentColor: 'rgb(var(--c-primary))',
    labelOffsetY: 115,
    image: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=600&auto=format&fit=crop&q=80',
  },
  {
    id: 'building-sports',
    code: 'SPORTS',
    name: 'Complexe Sportif Universitaire',
    nameAr: 'المركب الرياضي الجامعي',
    category: 'SPORTS & BIEN-ÊTRE',
    categoryTag: 'ZONAS DEPORTIVAS',
    rating: 4.7,
    description: 'Terrains de football, courts de tennis, salle omnisports et vestiaires PMR.',
    descriptionAr: 'ملاعب كرة القدم والتنس والقاعة متعددة الرياضات.',
    isoX: 1000,
    isoY: 320,
    width: 110,
    depth: 85,
    height: 55,
    accentColor: 'rgb(var(--c-primary))',
    labelOffsetY: 80,
    image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&auto=format&fit=crop&q=80',
  },
  {
    id: 'building-admin',
    code: 'ADMIN',
    name: 'Administration Centrale & Accueil PMR',
    nameAr: 'الإدارة المركزية واستقبال ذوي الاحتياجات',
    category: 'SERVICES ADMINISTRATIFS',
    categoryTag: 'EDIFICIO CENTRAL',
    rating: 4.9,
    description: 'Scolarité, bureau d’accessibilité PMR, infirmerie et direction du campus.',
    descriptionAr: 'مصلحة التمدرس ومكتب مرافقة ذوي الإعاقة والإدارة.',
    isoX: 420,
    isoY: 640,
    width: 120,
    depth: 90,
    height: 60,
    accentColor: 'rgb(var(--c-primary-800))',
    labelOffsetY: 90,
    image: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&auto=format&fit=crop&q=80',
  },
];

export function IsometricCampusMap({
  onSelectRoom,
  onOpenDijkstraRoute,
  onOpenFloorPlan,
}: {
  onSelectRoom?: (code: string) => void;
  onOpenDijkstraRoute?: (toTarget: string) => void;
  onOpenFloorPlan?: (floorId: string) => void;
}) {
  const { i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const toast = useToast();
  const buildingsQuery = useBuildings();
  const roomsQuery = useRooms();

  // Selected Building
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('building-a');
  const [hoveredBuildingId, setHoveredBuildingId] = useState<string | null>(null);

  // SVG Structure Floor View
  const [activeFloorIndex, setActiveFloorIndex] = useState<number>(0);
  const [showSvgViewerModal, setShowSvgViewerModal] = useState<boolean>(false);
  const [svgZoom, setSvgZoom] = useState<number>(1);

  // Map Zoom & Pan
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Matching database building
  const selectedBuildingData: IsometricBuildingData = useMemo(() => {
    return ISO_BUILDINGS.find((b) => b.id === selectedBuildingId) ?? ISO_BUILDINGS[0]!;
  }, [selectedBuildingId]);

  const dbBuilding = useMemo(() => {
    if (!buildingsQuery.data?.items) return null;
    return (
      buildingsQuery.data.items.find((b) => b.code === selectedBuildingData.code) ??
      buildingsQuery.data.items[0]
    );
  }, [buildingsQuery.data, selectedBuildingData.code]);

  // Selected floor ID for SVG loading
  const currentFloorId = useMemo(() => {
    if (!dbBuilding?.floors?.length) return null;
    const safeIdx = Math.min(activeFloorIndex, dbBuilding.floors.length - 1);
    return dbBuilding.floors[safeIdx]?.id ?? dbBuilding.floors[0]?.id ?? null;
  }, [dbBuilding, activeFloorIndex]);

  // Query Floor SVG Structure
  const floorSvg = useFloorSvg(currentFloorId);
  const layers = useMapPrefs((s) => s.layers);
  const floorPlanQuery = useFloorPlan(currentFloorId);
  const [selectedMapItem, setSelectedMapItem] = useState<MapItem | null>(null);
  const [modalTab, setModalTab] = useState<'architecture' | 'svg'>('architecture');

  // Auto-highlight A-104 or first room when floor plan is loaded (matching user mockup)
  useEffect(() => {
    if (floorPlanQuery.data?.layers.rooms?.features?.length) {
      const a104 = floorPlanQuery.data.layers.rooms.features.find(
        (f) => f.properties.code === 'A-104',
      );
      const chosen = a104 ?? floorPlanQuery.data.layers.rooms.features[0];
      if (chosen) {
        setSelectedMapItem({ kind: 'room', id: chosen.id });
      }
    }
  }, [floorPlanQuery.data]);

  // Filter rooms of the selected building and current floor
  const currentFloorRooms = useMemo(() => {
    if (!roomsQuery.data?.items || !dbBuilding?.floors?.length) return [];
    const floor = dbBuilding.floors[activeFloorIndex] ?? dbBuilding.floors[0];
    if (!floor) return [];
    return roomsQuery.data.items.filter(
      (r) => r.building.id === dbBuilding.id && r.floor.level === floor.level,
    );
  }, [roomsQuery.data, dbBuilding, activeFloorIndex]);

  // Sorted buildings for correct isometric painter depth ordering (back to front)
  const sortedBuildings = useMemo(() => {
    return [...ISO_BUILDINGS].sort((a, b) => a.isoY - b.isoY);
  }, []);
  const displayedSvgContent = useMemo(() => {
    if (floorSvg.data?.svgContent) {
      return floorSvg.data.svgContent;
    }
    // Architecture by default matching exact design in uploaded mockup
    const buildingCode = selectedBuildingData.code;
    const levelPrefix = activeFloorIndex === 0 ? '1' : `${activeFloorIndex + 1}`;

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
      const r = currentFloorRooms.find((x) => x.code === fallbackCode) ?? currentFloorRooms[idx];
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
      if (st === 'ADMIN') return { bg: 'rgb(var(--c-occupied-bg))', border: 'rgb(var(--c-occupied))', badgeBg: 'rgb(var(--c-occupied))', icon: '👥' };
      if (st === 'CLUB') return { bg: 'rgb(var(--c-club-bg))', border: 'rgb(var(--c-primary))', badgeBg: 'rgb(var(--c-club))', icon: '★' };
      return { bg: 'rgb(var(--c-available-bg))', border: 'rgb(var(--c-available))', badgeBg: 'rgb(var(--c-available))', icon: '✔' };
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
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="rgb(var(--c-ink))" flood-opacity="0.12" />
    </filter>
    <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgb(var(--c-primary))" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Architectural Background Canvas (Light theme matching user design) -->
  <rect width="1020" height="640" fill="rgb(var(--c-canvas))" />

  <!-- Outer Floor Boundary Slab -->
  <path d="M 60 70 L 960 70 L 960 280 L 980 280 L 980 480 L 960 480 L 960 600 L 60 600 L 60 300 L 40 300 L 40 100 L 60 100 Z" fill="#FFFFFF" stroke="rgb(var(--c-line))" stroke-width="2.5" />

  <!-- Corridors & Internal Wall Partitions -->
  <path d="M 70 270 L 950 270 M 70 380 L 950 380" stroke="rgb(var(--c-line))" stroke-width="2" stroke-dasharray="4,4" />

  <!-- ==================== TOP ROW ROOMS ==================== -->
  <!-- Room 101 -->
  <g id="room-${r101.code}">
    <rect x="75" y="85" width="160" height="180" rx="8" fill="${c101.bg}" stroke="${c101.border}" stroke-width="2.5" />
    <circle cx="155" cy="140" r="15" fill="${c101.badgeBg}" />
    <text x="155" y="146" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c101.icon}</text>
    <text x="155" y="195" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r101.code}</text>
  </g>

  <!-- Room 102 -->
  <g id="room-${r102.code}">
    <rect x="245" y="85" width="180" height="180" rx="8" fill="${c102.bg}" stroke="${c102.border}" stroke-width="2.5" />
    <circle cx="335" cy="140" r="15" fill="${c102.badgeBg}" />
    <text x="335" y="146" text-anchor="middle" fill="#FFFFFF" font-size="13" font-weight="900">${c102.icon}</text>
    <text x="335" y="195" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r102.code}</text>
  </g>

  <!-- Room 103 -->
  <g id="room-${r103.code}">
    <rect x="435" y="125" width="165" height="140" rx="8" fill="${c103.bg}" stroke="${c103.border}" stroke-width="2.5" />
    <circle cx="517" cy="165" r="15" fill="${c103.badgeBg}" />
    <text x="517" y="171" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c103.icon}</text>
    <text x="517" y="215" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r103.code}</text>
  </g>

  <!-- Room 104 (Selected Target Room) -->
  <g id="room-${r104.code}">
    <rect x="610" y="80" width="165" height="185" rx="8" fill="${c104.bg}" stroke="rgb(var(--c-available))" stroke-width="3.5" />
    <circle cx="692" cy="140" r="15" fill="${c104.badgeBg}" />
    <text x="692" y="146" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c104.icon}</text>
    <text x="692" y="195" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r104.code}</text>
  </g>

  <!-- Room 105 -->
  <g id="room-${r105.code}">
    <rect x="785" y="125" width="155" height="140" rx="8" fill="${c105.bg}" stroke="${c105.border}" stroke-width="2.5" />
    <circle cx="862" cy="165" r="15" fill="${c105.badgeBg}" />
    <text x="862" y="171" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c105.icon}</text>
    <text x="862" y="215" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r105.code}</text>
  </g>

  <!-- ==================== BOTTOM ROW ROOMS ==================== -->
  <!-- Room 106 -->
  <g id="room-${r106.code}">
    <rect x="75" y="380" width="180" height="200" rx="8" fill="${c106.bg}" stroke="${c106.border}" stroke-width="2.5" />
    <circle cx="165" cy="445" r="15" fill="${c106.badgeBg}" />
    <text x="165" y="451" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c106.icon}</text>
    <text x="165" y="500" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r106.code}</text>
  </g>

  <!-- Central Amenities: Elevator & Restrooms -->
  <!-- Elevator -->
  <g id="poi-elevator" transform="translate(320, 395)">
    <rect width="70" height="70" rx="12" fill="rgb(var(--c-primary))" filter="url(#shadow)" />
    <!-- Elevator Double Doors & Direction -->
    <rect x="17" y="16" width="16" height="38" rx="2" fill="#FFFFFF" />
    <rect x="37" y="16" width="16" height="38" rx="2" fill="#FFFFFF" />
    <polygon points="12,35 6,35 9,30" fill="#FFFFFF" />
    <polygon points="58,35 64,35 61,40" fill="#FFFFFF" />
  </g>

  <!-- Restrooms (WC) -->
  <g id="poi-restrooms" transform="translate(470, 395)">
    <rect width="70" height="70" rx="12" fill="rgb(var(--c-primary))" filter="url(#shadow)" />
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
    <text x="720" y="515" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r107.code}</text>
  </g>

  <!-- Room 108 -->
  <g id="room-${r108.code}">
    <rect x="825" y="380" width="150" height="200" rx="8" fill="${c108.bg}" stroke="${c108.border}" stroke-width="2.5" />
    <circle cx="900" cy="445" r="15" fill="${c108.badgeBg}" />
    <text x="900" y="451" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="900">${c108.icon}</text>
    <text x="900" y="500" text-anchor="middle" fill="rgb(var(--c-ink))" font-size="20" font-weight="900" font-family="system-ui, -apple-system, sans-serif">${r108.code}</text>
  </g>

  <!-- ==================== POI BADGES (AROUND PERIMETER) ==================== -->
  <!-- Top-Left Emergency Exit -->
  <g id="poi-exit-left" transform="translate(30, 110)">
    <rect width="36" height="36" rx="8" fill="rgb(var(--c-available))" />
    <text x="18" y="25" text-anchor="middle" fill="#FFFFFF" font-size="18">🏃</text>
  </g>

  <!-- Middle-Left Stairs -->
  <g id="poi-stairs" transform="translate(20, 450)">
    <rect width="44" height="44" rx="10" fill="rgb(var(--c-route))" />
    <path d="M 12 32 L 20 32 L 20 24 L 28 24 L 28 16 L 36 16" stroke="#FFFFFF" stroke-width="3" fill="none" stroke-linecap="round" />
  </g>

  <!-- Right PMR Wheelchair Access -->
  <g id="poi-pmr" transform="translate(965, 285)">
    <rect width="38" height="38" rx="8" fill="rgb(var(--c-route))" />
    <text x="19" y="27" text-anchor="middle" fill="#FFFFFF" font-size="22" font-weight="bold">♿</text>
  </g>

  <!-- Bottom-Right Emergency Exit -->
  <g id="poi-exit-right" transform="translate(965, 420)">
    <rect width="36" height="36" rx="8" fill="rgb(var(--c-available))" />
    <text x="18" y="25" text-anchor="middle" fill="#FFFFFF" font-size="18">🏃</text>
  </g>

  <!-- ==================== BLUE NAVIGATION ROUTE ==================== -->
  <!-- Curved Route Polyline (Exact curve from image) -->
  <path d="M 325 540 L 375 490 Q 400 465 435 465 L 455 465 Q 485 465 485 435 L 485 375 Q 485 345 515 345 L 665 345 Q 692 345 692 315 L 692 275" fill="none" stroke="rgb(var(--c-primary))" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" filter="url(#routeGlow)" />

  <!-- Start Location Pin: Blue Circle with Navigation Arrow -->
  <g id="route-start" transform="translate(325, 540)">
    <circle cx="0" cy="0" r="23" fill="#FFFFFF" stroke="rgb(var(--c-sage))" stroke-width="3" filter="url(#shadow)" />
    <circle cx="0" cy="0" r="17" fill="rgb(var(--c-primary))" />
    <path d="M 0 -10 L 7 8 L 0 5 L -7 8 Z" fill="#FFFFFF" />
  </g>

  <!-- Destination Pin: Purple Pin at A-104 Door -->
  <g id="route-destination" transform="translate(692, 275)">
    <circle cx="0" cy="0" r="16" fill="rgb(var(--c-primary-800))" filter="url(#shadow)" />
    <circle cx="0" cy="0" r="6" fill="#FFFFFF" />
  </g>

  <!-- ==================== POPOVER TOOLTIP CALLOUT ==================== -->
  <g id="callout-tooltip" transform="translate(692, 25)">
    <rect x="-115" y="0" width="230" height="38" rx="10" fill="#FFFFFF" stroke="rgb(var(--c-line))" stroke-width="1.5" filter="url(#shadow)" />
    <polygon points="-8,38 8,38 0,46" fill="#FFFFFF" />
    <text x="0" y="24" text-anchor="middle" font-size="13" font-family="system-ui, -apple-system, sans-serif">
      <tspan fill="rgb(var(--c-ink))" font-weight="900">${r104.code} · </tspan>
      <tspan fill="rgb(var(--c-available))" font-weight="900">Available</tspan>
      <tspan fill="rgb(var(--c-muted))" font-weight="600"> · until 14:00</tspan>
    </text>
  </g>
</svg>`;
  }, [floorSvg.data, selectedBuildingData, activeFloorIndex, currentFloorRooms]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const distance = e.shiftKey ? 40 : 16;
    const moves: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: distance, y: 0 },
      ArrowRight: { x: -distance, y: 0 },
      ArrowUp: { x: 0, y: distance },
      ArrowDown: { x: 0, y: -distance },
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    setPanOffset((p) => ({ x: p.x + move.x, y: p.y + move.y }));
  };

  const resetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const downloadSvgFile = () => {
    if (!displayedSvgContent) return;
    const blob = new Blob([displayedSvgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plan_structure_${selectedBuildingData.code}_niveau_${activeFloorIndex}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    toast.show('Téléchargement du fichier SVG en cours...', { tone: 'success' });
  };

  return (
    <div className="relative h-[min(82dvh,54rem)] w-full overflow-hidden rounded-card border-2 border-line bg-canvas shadow-card">
      {/* ========================================================================= */}
      {/* 1. TOP FLOATING BAR (Mockup Inspired: Search, Breadcrumbs, Campus Header) */}
      {/* ========================================================================= */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Campus Brand Badge */}
        <div className="pointer-events-auto flex items-center gap-3 rounded-card border-2 border-line bg-card px-4 py-2.5 shadow-card">
          <span className="flex size-7 items-center justify-center rounded-control bg-primary text-on-primary font-black text-sm shadow-card">
            CW
          </span>
          <div>
            <h1 className="text-sm font-black tracking-wider text-ink uppercase">
              accesU 3D
            </h1>
            <p className="text-sm text-muted">
              {lang === 'ar' ? 'مخطط الحرم الجامعي ثلاثي الأبعاد' : 'Plan 3D Isométrique du Campus & Fichiers SVG'}
            </p>
          </div>
        </div>

        {/* Action Pills */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-card border-2 border-line bg-card p-1.5 shadow-card">
          <span className="hidden sm:inline px-3 text-sm font-bold text-muted">
            Cliquez sur un bâtiment pour afficher son plan de structure SVG
          </span>
          <Button
            variant="secondary"
            icon={FileCode}
            className="font-bold text-sm"
            onClick={() => setShowSvgViewerModal(true)}
          >
            Structure SVG ({selectedBuildingData.code})
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. LEFT FLOATING CARD (Matches Left Building Profile Card in Image Mockup) */}
      {/* ========================================================================= */}
      <div className="absolute top-20 bottom-6 left-4 z-20 w-full max-w-[21rem] pointer-events-none hidden tablet:flex flex-col">
        <div className="pointer-events-auto flex h-full flex-col overflow-hidden rounded-card border-2 border-line bg-card shadow-float transition-all">
          {/* Card Header Image */}
          <div className="relative h-36 w-full shrink-0 overflow-hidden bg-surface-2">
            <img
              src={selectedBuildingData.image}
              alt={selectedBuildingData.name}
              className="h-full w-full object-cover brightness-95"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
            <div className="absolute top-3 left-3">
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-black text-on-primary uppercase tracking-wider shadow-card">
                {selectedBuildingData.categoryTag}
              </span>
            </div>
            <div className="absolute bottom-3 left-3 right-3 text-white">
              <span className="text-sm font-semibold uppercase tracking-wider text-primary">
                {selectedBuildingData.category}
              </span>
              <h2 className="text-base font-black truncate">{selectedBuildingData.name}</h2>
            </div>
          </div>

          {/* Quick Action Icons Bar (Inspired by yellow circles in user image) */}
          <div className="grid grid-cols-5 gap-1 border-b border-line p-2 bg-surface-2">
            <button
              type="button"
              onClick={() => onOpenDijkstraRoute?.(`room:${selectedBuildingData.code === 'A' ? 'A-104' : 'B-201'}`)}
              className="group flex flex-col items-center gap-1 p-1.5 rounded-card transition-all"
              title="Itinéraire Dijkstra"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-on-primary font-bold shadow-card group-hover:scale-105 transition-transform">
                <Navigation className="size-4" />
              </span>
              <span className="text-sm font-bold text-muted group-hover:text-ink">Itinéraire</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSvgViewerModal(true)}
              className="group flex flex-col items-center gap-1 p-1.5 rounded-card transition-all"
              title="Afficher le plan SVG de la structure"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-on-primary font-bold shadow-card group-hover:scale-105 transition-transform">
                <FileCode className="size-4" />
              </span>
              <span className="text-sm font-bold text-muted group-hover:text-ink">Plan SVG</span>
            </button>

            <button
              type="button"
              onClick={() => toast.show(`Bâtiment ${selectedBuildingData.code} sauvegardé !`, { tone: 'success' })}
              className="group flex flex-col items-center gap-1 p-1.5 rounded-card transition-all"
              title="Sauvegarder"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-ink border border-line font-bold group-hover:bg-primary group-hover:text-on-primary transition-all">
                <Bookmark className="size-4" />
              </span>
              <span className="text-sm font-bold text-muted group-hover:text-ink">Sauver</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const targetRoom = currentFloorRooms[0]?.code || `${selectedBuildingData.code}-101`;
                onSelectRoom?.(targetRoom);
              }}
              className="group flex flex-col items-center gap-1 p-1.5 rounded-card transition-all"
              title="Salles"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-ink border border-line font-bold group-hover:bg-primary group-hover:text-on-primary transition-all">
                <Building2 className="size-4" />
              </span>
              <span className="text-sm font-bold text-muted group-hover:text-ink">Salles</span>
            </button>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.show('Lien du bâtiment copié !', { tone: 'success' });
              }}
              className="group flex flex-col items-center gap-1 p-1.5 rounded-card transition-all"
              title="Partager"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-ink border border-line font-bold group-hover:bg-primary group-hover:text-on-primary transition-all">
                <Share2 className="size-4" />
              </span>
              <span className="text-sm font-bold text-muted group-hover:text-ink">Partager</span>
            </button>
          </div>

          {/* Floors & SVG Structure Selector Section */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="size-3.5 text-primary" />
                  Étages &amp; Structure SVG
                </span>
                <span className="text-sm text-muted font-semibold">
                  {dbBuilding?.floors.length || 3} niveaux
                </span>
              </div>

              {/* Floor Level Pills */}
              <div className="grid grid-cols-3 gap-1.5">
                {(dbBuilding?.floors ?? [{ id: '1', level: 0 }, { id: '2', level: 1 }, { id: '3', level: 2 }]).map(
                  (fl, idx) => {
                    const active = activeFloorIndex === idx;
                    return (
                      <button
                        key={fl.id}
                        type="button"
                        onClick={() => setActiveFloorIndex(idx)}
                        className={cn(
                          'flex flex-col items-center justify-center rounded-card py-2 px-1 text-sm font-bold transition-all border',
                          active
                            ? 'bg-primary text-on-primary border-primary shadow-card'
                            : 'bg-surface-2 text-ink border-line hover:border-primary/50',
                        )}
                      >
                        <span>{fl.level === 0 ? 'RDC' : `Étage ${fl.level}`}</span>
                        <span className="text-sm opacity-75">Niveau {fl.level}</span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            {/* Direct Floor SVG Mini-Blueprint View */}
            <div className="rounded-card border-2 border-line bg-surface-2 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-ink flex items-center gap-1.5">
                  <FileCode className="size-4 text-primary" />
                  Structure Fichier SVG
                </span>
                <button
                  type="button"
                  onClick={() => setShowSvgViewerModal(true)}
                  className="text-sm font-bold text-primary hover:underline flex items-center gap-0.5"
                >
                  <Maximize2 className="size-3" />
                  Agrandir
                </button>
              </div>

              {/* Mini SVG Rendering Preview */}
              <button
                type="button"
                onClick={() => setShowSvgViewerModal(true)}
                className="relative h-28 w-full cursor-pointer overflow-hidden rounded-card border border-line bg-card p-1.5 text-start group hover:border-primary transition-colors"
                title="Cliquez pour agrandir la structure SVG"
              >
                {floorSvg.data?.svgContent ? (
                  <div
                    className="h-full w-full flex items-center justify-center [&>svg]:h-full [&>svg]:w-full [&>svg]:object-contain"
                    dangerouslySetInnerHTML={{ __html: floorSvg.data.svgContent }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted text-sm">
                    <FileCode className="size-6 text-muted/60" />
                    <span>Chargement de la structure SVG...</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="rounded-full bg-ink px-2.5 py-1 text-sm font-bold text-card shadow-card">
                    Ouvrir le plan SVG
                  </span>
                </div>
              </button>

              <div className="flex items-center justify-between text-sm text-muted">
                <span>{floorSvg.data?.svgContent ? '✓ Plan de structure SVG' : '✓ En attente de fichier SVG'}</span>
                <button
                  type="button"
                  onClick={downloadSvgFile}
                  className="font-bold text-ink hover:text-primary flex items-center gap-1"
                >
                  <Download className="size-3" />
                  Télécharger
                </button>
              </div>
            </div>

            {/* Rooms on this floor */}
            <div>
              <p className="text-sm font-bold text-muted uppercase tracking-wider mb-2">
                Salles sur cet étage ({currentFloorRooms.length})
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {currentFloorRooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRoom?.(r.code)}
                    className="flex w-full items-center justify-between gap-2 rounded-card border border-line bg-card p-2 text-start text-sm hover:border-primary transition-all"
                  >
                    <div>
                      <span className="font-black text-ink">{r.code}</span>
                      <span className="block text-sm text-muted truncate max-w-[130px]">
                        {lang === 'ar' && r.nameAr ? r.nameAr : r.name}
                      </span>
                    </div>
                    <StatusBadge status={r.status.status} label={r.status.label} size="sm" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. 3D ISOMETRIC VECTOR CAMPUS MAP SVG CANVAS                             */}
      {/* ========================================================================= */}
      <button
        type="button"
        aria-label="Campus overview. Use the arrow keys to pan."
        className="h-full w-full cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onKeyDown={handleCanvasKeyDown}
      >
        <svg
          viewBox="0 0 1200 820"
          className="h-full w-full transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: '55% 45%',
          }}
        >
          <defs>
            {/* Ground grid pattern (Isometric Dots / Mesh) */}
            <pattern id="isoDots" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.2" fill="rgb(var(--c-line))" />
            </pattern>

            {/* Tree Drop Shadow Filter */}
            <filter id="buildingGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="rgb(var(--c-ink))" floodOpacity="0.12" />
            </filter>

            <filter id="activeGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="rgb(var(--c-primary))" floodOpacity="0.45" />
            </filter>

            {/* Linear gradients for 3D building sides */}
            <linearGradient id="wallFront" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="rgb(var(--c-line))" />
            </linearGradient>

            <linearGradient id="wallSide" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(var(--c-line))" />
              <stop offset="100%" stopColor="rgb(var(--c-line-strong))" />
            </linearGradient>

            <linearGradient id="yellowRoof" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(var(--c-primary))" />
              <stop offset="100%" stopColor="rgb(var(--c-primary))" />
            </linearGradient>

            <linearGradient id="yellowCourt" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(var(--c-cream))" />
              <stop offset="100%" stopColor="rgb(var(--c-primary-800))" />
            </linearGradient>

            <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(var(--c-surface-2))" />
              <stop offset="100%" stopColor="rgb(var(--c-soft))" />
            </linearGradient>

            <linearGradient id="parkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(var(--c-cream))" />
              <stop offset="100%" stopColor="rgb(var(--c-available-bg))" />
            </linearGradient>
          </defs>

          {/* 1. Base Campus Ground & Dot Grid */}
          <rect width="1200" height="820" fill="rgb(var(--c-canvas))" />
          <rect width="1200" height="820" fill="url(#isoDots)" />

          {/* 2. Campus Roads & Pedestrian Paths (2:1 Isometric Angles) */}
          <g id="roads" opacity="0.9">
            {/* Main Peripheral Avenue */}
            <path
              d="M 40 730 L 1180 130 L 1180 200 L 40 800 Z"
              fill="#FFFFFF"
              stroke="rgb(var(--c-line))"
              strokeWidth="3"
            />
            {/* Center Crossing Avenue */}
            <path
              d="M 80 160 L 1150 690 L 1080 730 L 20 200 Z"
              fill="#FFFFFF"
              stroke="rgb(var(--c-line))"
              strokeWidth="3"
            />
            {/* Pedestrian Pathways connecting wide spaced blocks */}
            <path
              d="M 230 280 L 380 430 L 420 680 M 380 430 L 740 230 L 1000 380"
              fill="none"
              stroke="rgb(var(--c-line))"
              strokeWidth="2.5"
              strokeDasharray="6 6"
            />
            {/* Crosswalk Zebra Stripes */}
            <g opacity="0.6">
              {[0, 10, 20, 30, 40].map((dx) => (
                <line
                  key={dx}
                  x1={470 + dx}
                  y1={420 - dx * 0.5}
                  x2={490 + dx}
                  y2={455 - dx * 0.5}
                  stroke="rgb(var(--c-line-strong))"
                  strokeWidth="3"
                />
              ))}
            </g>
          </g>

          {/* 3. Landscaped Parks & Tree Clusters */}
          <g id="parks">
            {/* North Park near Resto */}
            <path
              d="M 80 140 L 280 240 L 180 290 L -20 190 Z"
              fill="url(#parkGrad)"
              stroke="rgb(var(--c-sage))"
              strokeWidth="1.5"
              rx="15"
            />
            {/* South Lake & Water Feature */}
            <path
              d="M 680 620 C 750 590, 830 600, 860 640 C 880 680, 810 720, 730 710 C 660 700, 630 640, 680 620 Z"
              fill="url(#waterGrad)"
              stroke="rgb(var(--c-soft))"
              strokeWidth="2"
            />
            {/* Campus Central Tree Dot Patterns distributed around spacious blocks */}
            {[
              [100, 210], [140, 240], [210, 190], [110, 310], [150, 350],
              [280, 290], [310, 330], [290, 420], [320, 460],
              [520, 280], [560, 310], [600, 340], [540, 400],
              [780, 270], [820, 300], [860, 250], [900, 280],
              [340, 620], [370, 660], [540, 620], [580, 660],
              [800, 520], [840, 550], [1100, 400], [1130, 430],
            ].map(([tx, ty], i) => (
              <g key={i} transform={`translate(${tx}, ${ty})`}>
                <ellipse cx="0" cy="4" rx="8" ry="4" fill="#000000" opacity="0.08" />
                <line x1="0" y1="4" x2="0" y2="-4" stroke="rgb(var(--c-primary-800))" strokeWidth="2.5" />
                <circle cx="0" cy="-8" r="9" fill="rgb(var(--c-available))" />
                <circle cx="-2" cy="-10" r="7" fill="rgb(var(--c-available))" opacity="0.8" />
              </g>
            ))}
          </g>

          {/* 4. Yellow Sports Center Courts (Repositioned alongside Sports Building) */}
          <g id="sports-courts" transform="translate(860, 460)">
            {/* Court Base (Bright Yellow from mockup) */}
            <polygon
              points="0,60 140,0 260,60 120,120"
              fill="url(#yellowCourt)"
              stroke="rgb(var(--c-club))"
              strokeWidth="2"
            />
            {/* White Field Lines */}
            <polygon
              points="10,60 140,5 250,60 120,115"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2"
              opacity="0.9"
            />
            <line x1="65" y1="32" x2="185" y2="88" stroke="#FFFFFF" strokeWidth="2" opacity="0.9" />
            <ellipse cx="125" cy="60" rx="20" ry="10" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity="0.9" />

            {/* Secondary Court */}
            <polygon
              points="130,135 240,80 320,120 210,175"
              fill="url(#yellowCourt)"
              stroke="rgb(var(--c-club))"
              strokeWidth="2"
            />
            <polygon
              points="138,135 240,84 312,120 210,170"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.5"
              opacity="0.9"
            />
          </g>

          {/* 5. 3D Isometric Buildings (Sorted by isoY for depth order) */}
          <g id="buildings">
            {sortedBuildings.map((b) => {
              const isSelected = selectedBuildingId === b.id;
              const isHovered = hoveredBuildingId === b.id;
              const liftY = isSelected ? -10 : isHovered ? -5 : 0;

              // Isometric Vertices (Top, Left, Right faces)
              const bx = b.isoX;
              const by = b.isoY + liftY;
              const w = b.width;
              const d = b.depth;
              const h = b.height;

              // Iso angles: dx_w = w * 0.866, dy_w = w * 0.5
              const dxW = w * 0.75;
              const dyW = w * 0.42;
              const dxD = d * 0.75;
              const dyD = d * 0.42;

              return (
                <g
                  key={b.id}
                  className="cursor-pointer transition-all duration-300"
                  onClick={() => {
                    setSelectedBuildingId(b.id);
                    setShowSvgViewerModal(true);
                  }}
                  onMouseEnter={() => setHoveredBuildingId(b.id)}
                  onMouseLeave={() => setHoveredBuildingId(null)}
                  filter={isSelected ? 'url(#activeGlow)' : 'url(#buildingGlow)'}
                >
                  {/* Ground Shadow */}
                  <polygon
                    points={`
                      ${bx},${b.isoY + dyW + dyD + 10}
                      ${bx + dxW},${b.isoY + dyD + 10}
                      ${bx + dxW - dxD},${b.isoY + 10}
                      ${bx - dxD},${b.isoY + dyW + 10}
                    `}
                    fill="rgb(var(--c-ink))"
                    opacity="0.16"
                  />

                  {/* Left Facade Wall */}
                  <polygon
                    points={`
                      ${bx - dxD},${by + dyW}
                      ${bx},${by + dyW + dyD}
                      ${bx},${by + dyW + dyD - h}
                      ${bx - dxD},${by + dyW - h}
                    `}
                    fill="url(#wallSide)"
                    stroke="rgb(var(--c-line-strong))"
                    strokeWidth="1.5"
                  />

                  {/* Right Facade Wall */}
                  <polygon
                    points={`
                      ${bx},${by + dyW + dyD}
                      ${bx + dxW},${by + dyD}
                      ${bx + dxW},${by + dyD - h}
                      ${bx},${by + dyW + dyD - h}
                    `}
                    fill="url(#wallFront)"
                    stroke="rgb(var(--c-line))"
                    strokeWidth="1.5"
                  />

                  {/* Architectural Floor Division Bands */}
                  {[0.25, 0.5, 0.75].map((lvl) => (
                    <g key={lvl} opacity="0.45">
                      <line
                        x1={bx}
                        y1={by + dyW + dyD - h * lvl}
                        x2={bx + dxW}
                        y2={by + dyD - h * lvl}
                        stroke="rgb(var(--c-muted))"
                        strokeWidth="1.5"
                      />
                      <line
                        x1={bx - dxD}
                        y1={by + dyW - h * lvl}
                        x2={bx}
                        y2={by + dyW + dyD - h * lvl}
                        stroke="rgb(var(--c-line-strong))"
                        strokeWidth="1.5"
                      />
                    </g>
                  ))}

                  {/* Roof Top Face (Accent Yellow for key buildings, matching mockup) */}
                  <polygon
                    points={`
                      ${bx},${by + dyW + dyD - h}
                      ${bx + dxW},${by + dyD - h}
                      ${bx + dxW - dxD},${by - h}
                      ${bx - dxD},${by + dyW - h}
                    `}
                    fill={isSelected || b.code === 'A' || b.code === 'B' ? 'url(#yellowRoof)' : 'rgb(var(--c-line))'}
                    stroke={isSelected ? 'rgb(var(--c-primary))' : 'rgb(var(--c-line-strong))'}
                    strokeWidth={isSelected ? '3' : '1.5'}
                  />

                  {/* Rooftop Architecture & Glass Features */}
                  <polygon
                    points={`
                      ${bx + 10},${by + dyW + dyD - h - 12}
                      ${bx + dxW * 0.7},${by + dyD - h - 8}
                      ${bx + dxW * 0.7 - dxD * 0.6},${by - h - 4}
                      ${bx - dxD * 0.6 + 10},${by + dyW - h - 8}
                    `}
                    fill="rgb(var(--c-route))"
                    opacity="0.35"
                    stroke="rgb(var(--c-primary))"
                    strokeWidth="1"
                  />

                  {/* ======================================================= */}
                  {/* FLOATING 3D YELLOW BADGE (Exact Match to Image Mockup!) */}
                  {/* ======================================================= */}
                  <g
                    transform={`translate(${bx}, ${by - h - 25})`}
                    className="cursor-pointer transition-transform hover:scale-105"
                    onClick={() => {
                      setSelectedBuildingId(b.id);
                      setShowSvgViewerModal(true);
                    }}
                  >
                    {/* Stem Line pointing to building */}
                    <line x1="0" y1="0" x2="0" y2="25" stroke="rgb(var(--c-primary))" strokeWidth="2.5" />
                    <circle cx="0" cy="25" r="3.5" fill="rgb(var(--c-primary))" />

                    {/* Badge Container */}
                    <g transform="translate(-70, -28)">
                      <rect
                        width="140"
                        height="28"
                        rx="7"
                        fill="rgb(var(--c-primary))"
                        stroke="rgb(var(--c-club))"
                        strokeWidth="1.5"
                        filter="url(#buildingGlow)"
                      />
                      {/* Triangle Pointer */}
                      <polygon points="65,28 75,28 70,34" fill="rgb(var(--c-primary))" />
                      <text
                        x="70"
                        y="18"
                        textAnchor="middle"
                        fill="#000000"
                        fontSize="11"
                        fontWeight="900"
                        letterSpacing="0.5"
                        fontFamily="system-ui, -apple-system, sans-serif"
                      >
                        {b.categoryTag}
                      </text>
                    </g>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
      </button>

      {/* ========================================================================= */}
      {/* 4. BOTTOM-RIGHT CONTROLS (+, -, Reset View, Compass)                       */}
      {/* ========================================================================= */}
      <div className="absolute bottom-5 right-5 z-20 flex flex-col gap-2 rounded-card border-2 border-line bg-card p-1.5 shadow-card">
        <IconButton
          icon={Plus}
          label="Zoom Avant"
          variant="secondary"
          className="size-10"
          onClick={() => setZoomLevel((z) => Math.min(z + 0.2, 2.2))}
        />
        <IconButton
          icon={Minus}
          label="Zoom Arrière"
          variant="secondary"
          className="size-10"
          onClick={() => setZoomLevel((z) => Math.max(z - 0.2, 0.7))}
        />
        <IconButton
          icon={RotateCcw}
          label="Recentrer"
          variant="secondary"
          className="size-10"
          onClick={resetView}
        />
      </div>

      {/* ========================================================================= */}
      {/* 5. FULLSCREEN ARCHITECTURAL VECTOR SVG STRUCTURE VIEWER MODAL            */}
      {/* ========================================================================= */}
      {showSvgViewerModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4">
          <div className="relative flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-card border-2 border-line bg-card shadow-float animate-fade-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-line px-6 py-4 bg-surface-2">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-card bg-primary text-on-primary font-black">
                  <FileCode className="size-6" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-black text-ink flex items-center gap-2">
                      Structure · {selectedBuildingData.name}
                      <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-sm font-bold text-primary">
                        {activeFloorIndex === 0 ? 'RDC (Niveau 0)' : `Étage ${activeFloorIndex}`}
                      </span>
                    </h3>
                    {floorSvg.data?.isCustom ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-available/30 bg-available-bg px-2.5 py-0.5 text-sm font-bold text-available">
                        <FileCode className="size-3" /> Fichier SVG Importé
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-50 px-2.5 py-0.5 text-sm font-bold text-primary">
                        <Layers className="size-3" /> Architecture par défaut (Plan interactif)
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted">
                    {floorSvg.data?.isCustom && modalTab === 'svg'
                      ? 'Plan vectoriel importé pour cet étage avec repères architecturaux.'
                      : 'Architecture technique par défaut : Salles, couloirs, portes, ascenseur PMR 🛗, toilettes 🚻 et occupation en temps réel.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* View Switcher if custom SVG is available */}
                {floorSvg.data?.isCustom && (
                  <div className="flex rounded-card border border-line bg-card p-1 text-sm">
                    <button
                      type="button"
                      onClick={() => setModalTab('architecture')}
                      className={cn(
                        'min-h-12 rounded-control px-2.5 py-1 font-bold transition-all',
                        modalTab === 'architecture'
                          ? 'bg-primary text-on-primary shadow-card'
                          : 'text-ink hover:bg-surface-2',
                      )}
                    >
                      Architecture 2D
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalTab('svg')}
                      className={cn(
                        'min-h-12 rounded-control px-2.5 py-1 font-bold transition-all',
                        modalTab === 'svg'
                          ? 'bg-primary text-on-primary shadow-card'
                          : 'text-ink hover:bg-surface-2',
                      )}
                    >
                      Fichier SVG
                    </button>
                  </div>
                )}

                {/* Floor Level Selector Inside Modal */}
                <div className="flex rounded-card border border-line bg-card p-1 text-sm">
                  {(dbBuilding?.floors ?? [{ id: '1', level: 0 }, { id: '2', level: 1 }, { id: '3', level: 2 }]).map(
                    (fl, idx) => (
                      <button
                        key={fl.id}
                        type="button"
                        onClick={() => setActiveFloorIndex(idx)}
                        className={cn(
                          'min-h-12 rounded-control px-2.5 py-1 font-bold transition-all',
                          activeFloorIndex === idx
                            ? 'bg-primary text-on-primary shadow-card'
                            : 'text-ink hover:bg-surface-2',
                        )}
                      >
                        {fl.level === 0 ? 'RDC' : `Étage ${fl.level}`}
                      </button>
                    ),
                  )}
                </div>

                {currentFloorId && onOpenFloorPlan && (
                  <Button
                    variant="secondary"
                    icon={Maximize2}
                    onClick={() => {
                      setShowSvgViewerModal(false);
                      onOpenFloorPlan(currentFloorId);
                    }}
                  >
                    Plein écran (Vue Plan)
                  </Button>
                )}

                {floorSvg.data?.isCustom && modalTab === 'svg' && (
                  <Button variant="secondary" icon={Download} onClick={downloadSvgFile}>
                    Télécharger SVG
                  </Button>
                )}

                <IconButton
                  icon={X}
                  label="Fermer"
                  variant="ghost"
                  onClick={() => setShowSvgViewerModal(false)}
                />
              </div>
            </div>

            {/* Modal Body: Custom Vector SVG OR Real Default FloorMap (Exact Match to User's Mockup) */}
            {floorSvg.data?.isCustom && modalTab === 'svg' ? (
              <div className="relative flex flex-1 items-center justify-center overflow-auto bg-canvas p-6">
                {/* Floor SVG Zoom Controls */}
                <div className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded-card border border-line bg-ink p-1">
                  <button
                    type="button"
                    onClick={() => setSvgZoom((z) => Math.min(z + 0.25, 3))}
                    className="flex min-h-12 min-w-12 items-center justify-center rounded-control p-1.5 text-card hover:bg-primary hover:text-on-primary"
                    title="Zoom +"
                  >
                    <ZoomIn className="size-4" />
                  </button>
                  <span className="px-1 text-sm font-bold text-card tabular">{Math.round(svgZoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setSvgZoom((z) => Math.max(z - 0.25, 0.5))}
                    className="flex min-h-12 min-w-12 items-center justify-center rounded-control p-1.5 text-card hover:bg-primary hover:text-on-primary"
                    title="Zoom -"
                  >
                    <ZoomOut className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSvgZoom(1)}
                    className="flex min-h-12 min-w-12 items-center justify-center rounded-control p-1.5 text-card hover:bg-primary hover:text-on-primary"
                    title="Réinitialiser"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                </div>

                <div
                  className="max-h-full max-w-full transition-transform duration-100 ease-out"
                  style={{ transform: `scale(${svgZoom})`, transformOrigin: 'center center' }}
                  dangerouslySetInnerHTML={{ __html: floorSvg.data.svgContent }}
                />
              </div>
            ) : (
              /* REAL DEFAULT ARCHITECTURAL FLOOR MAP (Exact Match to User's Screenshot!) */
              <div className="relative flex-1 min-h-[460px] w-full overflow-hidden bg-card">
                {floorPlanQuery.data ? (
                  <FloorMap
                    scope="floor"
                    plan={floorPlanQuery.data}
                    overview={undefined}
                    layers={layers}
                    selected={selectedMapItem}
                    onSelect={(item) => {
                      setSelectedMapItem(item);
                      if (item.kind === 'room') {
                        const r = floorPlanQuery.data?.layers.rooms?.features.find((f) => f.id === item.id);
                        if (r) onSelectRoom?.(r.properties.code);
                      }
                    }}
                    label={`Plan d'architecture · ${selectedBuildingData.name}`}
                    describedBy="map-modal-help"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-12">
                    <p className="text-sm font-bold text-muted animate-pulse">
                      Chargement de l'architecture du bâtiment...
                    </p>
                  </div>
                )}
                <p id="map-modal-help" className="sr-only">
                  Navigation au clavier dans le plan d'étage.
                </p>
              </div>
            )}

            {/* Modal Footer Room Quick Access */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3 bg-surface-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-bold text-ink">Salles de cet étage :</span>
                <div className="flex flex-wrap gap-1.5">
                  {currentFloorRooms.slice(0, 6).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setShowSvgViewerModal(false);
                        onSelectRoom?.(r.code);
                      }}
                      className="rounded-control border border-line bg-card px-2.5 py-1 font-bold text-ink hover:border-primary transition-colors"
                    >
                      {r.code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  icon={Navigation}
                  className="bg-primary text-on-primary font-bold"
                  onClick={() => {
                    setShowSvgViewerModal(false);
                    onOpenDijkstraRoute?.(`room:${selectedBuildingData.code === 'A' ? 'A-104' : 'B-201'}`);
                  }}
                >
                  Itinéraire Dijkstra vers ce bâtiment
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
