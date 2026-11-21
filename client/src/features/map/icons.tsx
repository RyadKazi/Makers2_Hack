import { Accessibility, CircleParking, DoorOpen, Flag, Info, Landmark, Toilet, TrendingUp, createLucideIcon, type LucideIcon } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MapLayer } from '@/stores/mapPrefs';

/** Lucide has no stairs / elevator glyphs: two of our own in the same 24 px, 2 px-stroke style. */
export const StairsIcon = createLucideIcon('cw-stairs', [['path', { d: 'M3 20h5v-5h5v-5h5V5h3', key: 's1' }]]);
export const ElevatorIcon = createLucideIcon('cw-elevator', [
  ['rect', { x: '5', y: '3', width: '14', height: '18', rx: '2', key: 'e1' }],
  ['path', { d: 'm9 9 3-3 3 3', key: 'e2' }],
  ['path', { d: 'm9 15 3 3 3-3', key: 'e3' }],
]);

type PoiStyle = { icon: LucideIcon; tone: 'primary' | 'access' | 'dest'; accessibleBadge: boolean; layer: Exclude<MapLayer, 'classrooms' | 'status' | 'closed'> };

/**
 * Accessible features get a different tone AND a wheelchair badge on the pin,
 * so they are told apart by shape, not only by colour.
 */
export const POI_STYLE: Record<string, PoiStyle> = {
  ENTRANCE: { icon: DoorOpen, tone: 'primary', accessibleBadge: false, layer: 'entrances' },
  ACCESSIBLE_ENTRANCE: { icon: DoorOpen, tone: 'access', accessibleBadge: true, layer: 'entrances' },
  ELEVATOR: { icon: ElevatorIcon, tone: 'access', accessibleBadge: false, layer: 'elevators' },
  STAIRS: { icon: StairsIcon, tone: 'primary', accessibleBadge: false, layer: 'stairs' },
  RAMP: { icon: TrendingUp, tone: 'access', accessibleBadge: false, layer: 'ramps' },
  TOILET: { icon: Toilet, tone: 'primary', accessibleBadge: false, layer: 'toilets' },
  ACCESSIBLE_TOILET: { icon: Toilet, tone: 'access', accessibleBadge: true, layer: 'accessible_toilets' },
  FACILITY: { icon: Landmark, tone: 'primary', accessibleBadge: false, layer: 'facilities' },
  INFO_DESK: { icon: Info, tone: 'primary', accessibleBadge: false, layer: 'facilities' },
  PARKING_ACCESSIBLE: { icon: CircleParking, tone: 'access', accessibleBadge: true, layer: 'facilities' },
  /** Route destination (navigation only, not a layer item). */
  DESTINATION: { icon: Flag, tone: 'dest', accessibleBadge: false, layer: 'facilities' },
};

export const poiStyle = (type: string): PoiStyle => POI_STYLE[type] ?? POI_STYLE.FACILITY!;

const svgCache = new Map<string, string>();

/** Static SVG markup for a Lucide icon (Leaflet markers are plain HTML). */
export function iconSvg(Icon: LucideIcon, size = 20, key = Icon.displayName ?? 'icon'): string {
  const cacheKey = `${key}:${size}`;
  let svg = svgCache.get(cacheKey);
  if (!svg) {
    svg = renderToStaticMarkup(<Icon size={size} strokeWidth={2.25} aria-hidden="true" focusable="false" />);
    svgCache.set(cacheKey, svg);
  }
  return svg;
}

const ACCESS_BADGE = () => `<span class="cw-pin__badge" aria-hidden="true">${iconSvg(Accessibility, 12, 'badge')}</span>`;

/** 36 × 44 teardrop pin (DESIGN_REFERENCE §1, image 2). */
export function pinHtml(type: string): string {
  const s = poiStyle(type);
  return (
    `<span class="cw-pin cw-pin--${s.tone}" aria-hidden="true">` +
    `<svg class="cw-pin__shape" viewBox="0 0 36 44" focusable="false"><path d="M18 42.5S3.5 27.6 3.5 17a14.5 14.5 0 0 1 29 0C32.5 27.6 18 42.5 18 42.5Z"/></svg>` +
    `<span class="cw-pin__icon">${iconSvg(s.icon, 18, type)}</span>` +
    (s.accessibleBadge ? ACCESS_BADGE() : '') +
    `</span>`
  );
}
