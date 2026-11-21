/**
 * Leaflet (CRS.Simple, 1 unit = 1 m) floor plan or campus plan.
 *
 * - Geometry is rebuilt only when the floor, the layers or the language change;
 *   live status updates patch the room in place (class, label, accessible name), so
 *   keyboard focus is never lost and the change flashes briefly (not with reduced motion).
 * - Every room label, place pin and building label is a focusable button (Leaflet
 *   keyboard markers) in reading order. Arrow keys jump to the nearest item in that
 *   screen direction; Enter / Space opens it.
 */
import 'leaflet/dist/leaflet.css';
import './map.css';
import L from 'leaflet';
import { Ban, Locate, Minus, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CampusOverview, FloorPlan, RoomStatus } from '@/api/types';
import { IconButton } from '@/components/ui/Button';
import { STATUS_STYLE } from '@/components/ui/StatusBadge';
import { statusLine } from '@/features/rooms/roomModel';
import { isRtl } from '@/lib/hooks';
import type { MapLayer } from '@/stores/mapPrefs';
import type { Lang } from '@/stores/preferences';
import { polygonCentroid, polygonTop } from './geometry';
import { iconSvg, pinHtml, poiStyle } from './icons';
import { keyToDir, nextInDirection, readingOrder } from './spatialNav';

export type MapItemKind = 'room' | 'poi' | 'building';

export type XYPoint = { x: number; y: number };

/** Route drawn over the plan (navigation). Decorative for assistive tech: the step list carries the same information. */
export type MapOverlay = {
  done: XYPoint[][];
  todo: XYPoint[][];
  /** A proposed new route (reroute waiting for confirmation). */
  preview?: XYPoint[][];
  transitions?: (XYPoint & { label: string; kind: 'ELEVATOR' | 'STAIRS' })[];
  start?: (XYPoint & { label: string }) | null;
  end?: (XYPoint & { label: string }) | null;
  /** Changing it fits the view to fitPoints. */
  fitKey?: string;
  fitPoints?: XYPoint[];
  /** A new key restarts a decorative progressive path draw on this one view only. */
  animationKey?: string;
};

export type MapPosition = XYPoint & { accuracyM: number; follow: boolean };
export type MapItem = { kind: MapItemKind; id: string };

type Entry = {
  key: string;
  kind: MapItemKind;
  id: string;
  x: number;
  y: number;
  marker: L.Marker;
  path?: L.Path;
  status?: RoomStatus['status'] | undefined;
};

export type FloorMapProps = {
  scope: 'floor' | 'campus';
  plan: FloorPlan | undefined;
  overview: CampusOverview | undefined;
  layers: Record<MapLayer, boolean>;
  selected: MapItem | null;
  onSelect: (item: MapItem) => void;
  /** Accessible name of the plan region. */
  label: string;
  /** id of the element with keyboard instructions. */
  describedBy: string;
  overlay?: MapOverlay | null;
  position?: MapPosition | null;
  /** Pick mode: a click (or Enter on the plan, at the crosshair) reports a point. */
  onPick?: ((point: XYPoint) => void) | null;
  /** Lets a route animation release its camera as soon as the user drags the map. */
  onUserViewChange?: (() => void) | null;
};

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function roomLabelHtml(code: string, status: RoomStatus['status'] | null): string {
  if (!status) return `<span class="cw-label cw-label--plain">${esc(code)}</span>`;
  const s = STATUS_STYLE[status];
  return `<span class="cw-label cw-label--${status}"><span class="cw-label__swatch"><span class="${s.pattern}"></span>${iconSvg(s.icon, 12, status)}</span>${esc(code)}</span>`;
}

/** Status patterns, styled by theme tokens (see map.css). Inserted once into Leaflet's SVG. */
function installPatterns(svg: SVGElement): void {
  if (svg.querySelector('#cw-p-available')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = `
    <style>
      .cw-pb-available{fill:rgb(var(--c-available-bg))} .cw-pb-occupied{fill:rgb(var(--c-occupied-bg))} .cw-pb-club{fill:rgb(var(--c-club-bg))}
      .cw-pf-occupied{fill:rgb(var(--c-occupied));opacity:.35} .cw-pf-club{fill:rgb(var(--c-club));opacity:.5}
    </style>
    <pattern id="cw-p-available" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" class="cw-pb-available"/></pattern>
    <pattern id="cw-p-occupied" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" class="cw-pb-occupied"/><rect width="3.5" height="10" class="cw-pf-occupied"/></pattern>
    <pattern id="cw-p-club" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" class="cw-pb-club"/><circle cx="5" cy="5" r="1.8" class="cw-pf-club"/></pattern>`;
  svg.insertBefore(defs, svg.firstChild);
}

/** Centres a size-less DivIcon on its point once it is in the DOM (dy shifts it up). */
function centre(marker: L.Marker, above = false): void {
  const el = marker.getElement();
  if (!el) return;
  el.style.marginLeft = `${-el.offsetWidth / 2}px`;
  el.style.marginTop = above ? `${-el.offsetHeight - 10}px` : `${-el.offsetHeight / 2}px`;
}

const latLng = (x: number, y: number) => L.latLng(y, x);
const toBounds = (b: readonly number[]) => L.latLngBounds([b[1]!, b[0]!], [b[3]!, b[2]!]);

export function FloorMap({ scope, plan, overview, layers, selected, onSelect, label, describedBy, overlay = null, position = null, onPick = null, onUserViewChange = null }: FloorMapProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groups = useRef<{ base: L.LayerGroup; route: L.LayerGroup; markers: L.LayerGroup; callout: L.LayerGroup; me: L.LayerGroup } | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const entries = useRef(new Map<string, Entry>());
  const selectedRef = useRef('');
  /** Refit the plan on resize until the user takes control of the view. */
  const autoFit = useRef(true);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const fittedFor = useRef<string>('');
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onUserViewChangeRef = useRef(onUserViewChange);
  onUserViewChangeRef.current = onUserViewChange;
  const tRef = useRef(t);
  tRef.current = t;

  // ───── create / destroy the map ─────
  useEffect(() => {
    const el = host.current!;
    const renderer = L.svg({ padding: 0.5 });
    const map = L.map(el, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 4,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      attributionControl: false,
      zoomControl: false,
      renderer,
      keyboardPanDelta: 60,
      inertia: false,
    });
    map.getContainer().classList.add('cw-map');
    // Keep the plan inside its bounds without an animated pan (reduced motion; no animation left running on unmount).
    (map as unknown as { _panInsideMaxBounds: () => void })._panInsideMaxBounds = function (this: L.Map) {
      if (this.options.maxBounds) this.panInsideBounds(this.options.maxBounds, { animate: false });
    };
    map.setView([100, 110], 1);
    map.addLayer(renderer);
    map.on('dragstart', () => onUserViewChangeRef.current?.());
    installPatterns((renderer as unknown as { _container: SVGElement })._container);
    L.control.scale({ imperial: false, maxWidth: 120, position: 'bottomleft' }).addTo(map);
    groups.current = { base: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map), markers: L.layerGroup().addTo(map), callout: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map) };
    // Pick mode: click anywhere, or Enter on the plan itself to pick the crosshair (map centre).
    map.on('click', (e: L.LeafletMouseEvent) => pickRef.current?.({ x: e.latlng.lng, y: e.latlng.lat }));
    const onPickKey = (e: KeyboardEvent) => {
      if (!pickRef.current || e.target !== map.getContainer() || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      const c = map.getCenter();
      pickRef.current({ x: c.lng, y: c.lat });
    };
    el.addEventListener('keydown', onPickKey);
    mapRef.current = map;

    // Spatial keyboard navigation between markers; Space activates like Enter.
    const onKeyDown = (e: KeyboardEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-nav-key]');
      if (!target) return;
      // Enter and Space activate (Leaflet's own keypress handling is unreliable across browsers / AT).
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        target.click();
        return;
      }
      const dir = keyToDir(e.key);
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation(); // do not pan the map
      const from = entries.current.get(target.dataset.navKey!);
      if (!from) return;
      const nextKey = nextInDirection({ id: from.key, x: from.x, y: from.y }, [...entries.current.values()].map((x) => ({ id: x.key, x: x.x, y: x.y })), dir);
      const next = nextKey ? entries.current.get(nextKey) : undefined;
      if (next) {
        map.panInside(latLng(next.x, next.y), { padding: [60, 60] });
        next.marker.getElement()?.focus();
      }
    };
    el.addEventListener('keydown', onKeyDown, true);
    const takeOver = () => {
      autoFit.current = false;
    };
    el.addEventListener('pointerdown', takeOver);
    el.addEventListener('wheel', takeOver, { passive: true });
    el.addEventListener('keydown', takeOver);
    // Keep the selection (and its callout) in view when the map is resized, e.g. by the side panel.
    const resize = new ResizeObserver(() => {
      map.invalidateSize();
      const sel = entries.current.get(selectedRef.current);
      if (sel) map.panInside(latLng(sel.x, sel.y), { padding: [180, 120], animate: false });
      else if (autoFit.current && boundsRef.current) map.fitBounds(boundsRef.current, { padding: [24, 24], animate: false });
    });
    resize.observe(el);

    return () => {
      resize.disconnect();
      el.removeEventListener('keydown', onKeyDown, true);
      el.removeEventListener('keydown', onPickKey);
      el.removeEventListener('pointerdown', takeOver);
      el.removeEventListener('wheel', takeOver);
      el.removeEventListener('keydown', takeOver);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Accessible name of the keyboard-pannable container.
  useEffect(() => {
    const c = mapRef.current?.getContainer();
    c?.setAttribute('aria-label', label);
    c?.setAttribute('aria-describedby', describedBy);
    c?.setAttribute('aria-roledescription', t('map.mapView'));
  }, [label, describedBy, t]);

  // ───── geometry and markers ─────
  const planKey = scope === 'floor' ? `floor:${plan?.floor.id}:${plan?.layers.rooms?.features.length}:${plan?.layers.passages?.features.filter((f) => !f.properties.isOpen).length}` : `campus:${overview?.campus.id}:${overview?.outdoor.passages.features.filter((f) => !f.properties.isOpen).length}`;
  const layersKey = JSON.stringify(layers);

  useEffect(() => {
    const map = mapRef.current;
    const g = groups.current;
    if (!map || !g) return;
    g.base.clearLayers();
    g.markers.clearLayers();
    g.callout.clearLayers();
    entries.current.clear();
    const tt = tRef.current;
    const showStatus = layers.status;
    type Spec = { key: string; kind: MapItemKind; id: string; x: number; y: number; make: () => L.Marker; aria: string; path?: L.Path; status?: RoomStatus['status'] };
    const specs: Spec[] = [];

    const addPoi = (f: { id: string; geometry: { coordinates: unknown[] } | null; properties: { type: string; name: string; nameAr: string | null; layer: string } }) => {
      const style = poiStyle(f.properties.type);
      if (!layers[style.layer] || !f.geometry) return;
      const [x, y] = f.geometry.coordinates as [number, number];
      const name = lang === 'ar' && f.properties.nameAr ? f.properties.nameAr : f.properties.name;
      specs.push({
        key: `poi:${f.id}`,
        kind: 'poi',
        id: f.id,
        x,
        y,
        aria: tt('map.poiAria', { name, type: tt(`poiType.${f.properties.type}`) }),
        make: () => L.marker(latLng(x, y), { icon: L.divIcon({ className: 'cw-marker cw-marker--poi', html: pinHtml(f.properties.type), iconSize: [36, 44], iconAnchor: [18, 44] }), keyboard: true }),
      });
    };

    const addClosed = (features: { geometry: { coordinates: unknown[] } | null; properties: { isOpen: boolean; closedReason: string | null } }[]) => {
      if (!layers.closed) return;
      for (const f of features) {
        if (f.properties.isOpen || !f.geometry) continue;
        L.geoJSON(f.geometry as GeoJSON.Geometry, { style: () => ({ className: 'cw-closed' }), interactive: false }).addTo(g.base);
        const coords = f.geometry.coordinates as [number, number][];
        const mid = coords[Math.floor(coords.length / 2)] ?? coords[0]!;
        const tag = L.marker(latLng(mid[0], mid[1]), {
          icon: L.divIcon({ className: 'cw-marker', html: `<span class="cw-label" aria-hidden="true" style="color:rgb(var(--c-occupied))">${iconSvg(Ban, 14, 'ban')}${esc(tt('map.closed'))}</span>`, iconSize: null as unknown as L.PointExpression }),
          interactive: false,
          keyboard: false,
        }).addTo(g.base);
        centre(tag);
      }
    };

    if (scope === 'floor' && plan) {
      if (plan.outline) L.geoJSON(plan.outline as GeoJSON.Geometry, { style: () => ({ className: 'cw-floor' }), interactive: false }).addTo(g.base);
      if (layers.classrooms) {
        for (const f of plan.layers.rooms?.features ?? []) {
          const c = polygonCentroid(f.geometry);
          if (!c || !f.geometry) continue;
          const status = f.properties.status.status;
          const geo = L.geoJSON(f.geometry as GeoJSON.Geometry, { style: () => ({ className: `cw-room ${showStatus ? `cw-room--${status}` : ''}` }) });
          const path = geo.getLayers()[0] as L.Path;
          path.on('click', () => {
            if (!pickRef.current) onSelectRef.current({ kind: 'room', id: f.id });
          });
          geo.addTo(g.base);
          const name = lang === 'ar' && f.properties.nameAr ? f.properties.nameAr : f.properties.name;
          specs.push({
            key: `room:${f.id}`,
            kind: 'room',
            id: f.id,
            x: c.x,
            y: c.y,
            path,
            status,
            aria: tt('map.roomAria', { code: f.properties.code, name, status: statusLine(f.properties.status, tt, lang) }),
            make: () =>
              L.marker(latLng(c.x, c.y), {
                icon: L.divIcon({ className: 'cw-marker cw-marker--room', html: roomLabelHtml(f.properties.code, showStatus ? status : null), iconSize: null as unknown as L.PointExpression }),
                keyboard: true,
                riseOnHover: true,
              }),
          });
        }
      }
      L.geoJSON(plan.layers.walls as GeoJSON.FeatureCollection, { style: (f) => ({ className: `cw-wall cw-wall--${f?.properties.kind}` }), interactive: false }).addTo(g.base);
      addClosed(plan.layers.passages?.features ?? []);
      for (const layer of ['entrances', 'elevators', 'stairs', 'ramps', 'toilets', 'accessible_toilets', 'facilities'] as const) {
        for (const f of plan.layers[layer]?.features ?? []) addPoi(f);
      }
    }

    if (scope === 'campus' && overview) {
      for (const b of overview.buildings) {
        if (!b.footprint) continue;
        const geo = L.geoJSON(b.footprint as GeoJSON.Geometry, { style: () => ({ className: 'cw-footprint' }) });
        const path = geo.getLayers()[0] as L.Path;
        path.on('click', () => {
          if (!pickRef.current) onSelectRef.current({ kind: 'building', id: b.id });
        });
        geo.addTo(g.base);
        const name = lang === 'ar' ? b.nameAr : b.name;
        specs.push({
          key: `building:${b.id}`,
          kind: 'building',
          id: b.id,
          x: b.x,
          y: b.y - 15,
          path,
          aria: tt('map.buildingAria', { name }),
          make: () =>
            L.marker(latLng(b.x, b.y - 15), {
              icon: L.divIcon({ className: 'cw-marker', html: `<span class="cw-label cw-label--building cw-label--plain">${esc(name)}</span>`, iconSize: null as unknown as L.PointExpression }),
              keyboard: true,
            }),
        });
      }
      for (const f of overview.outdoor.passages.features) {
        if (f.properties.isOpen && f.geometry) L.geoJSON(f.geometry as GeoJSON.Geometry, { style: () => ({ className: 'cw-path' }), interactive: false }).addTo(g.base);
      }
      L.geoJSON(overview.outdoor.walls as GeoJSON.FeatureCollection, { style: (f) => ({ className: `cw-wall cw-wall--${f?.properties.kind}` }), interactive: false }).addTo(g.base);
      addClosed(overview.outdoor.passages.features);
      for (const fc of [overview.outdoor.entrances, overview.outdoor.ramps, overview.outdoor.facilities]) for (const f of fc.features) addPoi(f);
    }

    // DOM order = Tab order: reading order of the plan (mirrored in RTL).
    for (const s of readingOrder(specs, isRtl())) {
      const marker = s.make();
      marker.on('click', () => onSelectRef.current({ kind: s.kind, id: s.id }));
      marker.addTo(g.markers);
      const el = marker.getElement();
      if (el) {
        el.setAttribute('aria-label', s.aria);
        el.dataset.navKey = s.key;
        if (s.kind !== 'poi') centre(marker);
      }
      entries.current.set(s.key, { key: s.key, kind: s.kind, id: s.id, x: s.x, y: s.y, marker, ...(s.path ? { path: s.path } : {}), status: s.status });
    }

    // Fit the view when the floor / scope changes (not when layers are toggled).
    const fitKey = scope === 'floor' ? `floor:${plan?.floor.id}` : `campus:${overview?.campus.id}`;
    const bounds = scope === 'floor' ? plan?.bounds : overview?.bounds;
    if (bounds && fittedFor.current !== fitKey) {
      fittedFor.current = fitKey;
      const b = toBounds(bounds);
      boundsRef.current = b;
      autoFit.current = true;
      map.setMaxBounds(b.pad(0.5));
      map.fitBounds(b, { padding: [24, 24], animate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, planKey, layersKey, lang]);

  // ───── live status: patch rooms in place ─────
  useEffect(() => {
    if (scope !== 'floor' || !plan) return undefined;
    const timers: number[] = [];
    for (const f of plan.layers.rooms?.features ?? []) {
      const entry = entries.current.get(`room:${f.id}`);
      if (!entry) continue;
      const next = f.properties.status.status;
      const name = lang === 'ar' && f.properties.nameAr ? f.properties.nameAr : f.properties.name;
      const el = entry.marker.getElement();
      el?.setAttribute('aria-label', t('map.roomAria', { code: f.properties.code, name, status: statusLine(f.properties.status, t, lang) }));
      if (entry.status === next) continue;
      const pathEl = entry.path?.getElement();
      if (pathEl && layers.status) {
        pathEl.classList.remove(`cw-room--${entry.status}`);
        pathEl.classList.add(`cw-room--${next}`, 'is-flashing');
      }
      const labelEl = el?.querySelector('.cw-label');
      if (labelEl && layers.status) {
        labelEl.outerHTML = roomLabelHtml(f.properties.code, next);
        el?.querySelector('.cw-label')?.classList.add('is-flashing');
      }
      entry.status = next;
      timers.push(
        window.setTimeout(() => {
          pathEl?.classList.remove('is-flashing');
          el?.querySelector('.cw-label')?.classList.remove('is-flashing');
        }, 1700),
      );
    }
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [plan, scope, lang, layers.status, t]);

  // ───── selection: highlight + callout ─────
  const selectedKey = selected ? `${selected.kind}:${selected.id}` : '';
  selectedRef.current = selectedKey;
  useEffect(() => {
    const map = mapRef.current;
    const g = groups.current;
    if (!map || !g) return;
    g.callout.clearLayers();
    for (const e of entries.current.values()) {
      const on = e.key === selectedKey;
      e.marker.getElement()?.classList.toggle('is-selected', on);
      e.path?.getElement()?.classList.toggle('is-selected', on);
      e.marker.getElement()?.setAttribute('aria-pressed', String(on));
    }
    const entry = entries.current.get(selectedKey);
    if (!entry) return;
    // Room callouts are wide: keep room for them.
    map.panInside(latLng(entry.x, entry.y), { padding: entry.kind === 'room' ? [180, 120] : [80, 80] });
    if (entry.kind === 'room' && plan) {
      const f = plan.layers.rooms?.features.find((x) => x.id === entry.id);
      const top = f && polygonTop(f.geometry);
      if (f && top) {
        const text = `${f.properties.code} · ${statusLine(f.properties.status, t, lang)}`;
        const callout = L.marker(latLng(top.x, top.y), {
          icon: L.divIcon({ className: 'cw-marker', html: `<div class="cw-callout" aria-hidden="true">${esc(text)}</div>`, iconSize: null as unknown as L.PointExpression }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1000,
        }).addTo(g.callout);
        centre(callout, true);
        // Keep the whole callout inside the visible map (e.g. when the side panel narrows it).
        const box = callout.getElement()?.getBoundingClientRect();
        const frame = map.getContainer().getBoundingClientRect();
        if (box) {
          const dx = box.right > frame.right - 8 ? box.right - frame.right + 16 : box.left < frame.left + 8 ? box.left - frame.left - 16 : 0;
          const dy = box.top < frame.top + 8 ? box.top - frame.top - 16 : 0;
          if (dx || dy) map.panBy([dx, dy], { animate: false });
        }
      }
    }
  }, [selectedKey, plan, planKey, layersKey, lang, t]);

  // ───── route overlay ─────
  const overlayKey = overlay ? JSON.stringify([overlay.done, overlay.todo, overlay.preview, overlay.transitions, overlay.start, overlay.end, overlay.animationKey]) : '';
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.route.clearLayers();
    if (!overlay) return;
    const tag = (p: XYPoint, html: string, className = 'cw-marker') => {
      const m = L.marker(latLng(p.x, p.y), { icon: L.divIcon({ className, html, iconSize: null as unknown as L.PointExpression }), interactive: false, keyboard: false }).addTo(g.route);
      centre(m);
      m.getElement()?.setAttribute('aria-hidden', 'true');
    };
    const line = (pts: XYPoint[][], className: string, animated = false) => {
      for (const p of pts) if (p.length > 1) L.polyline(p.map((q) => latLng(q.x, q.y)), { className, interactive: false }).addTo(g.route);
      if (animated) {
        const last = pts.at(-1)?.at(-1);
        if (last) tag(last, '<span class="cw-route-tip"></span>');
      }
    };
    line(overlay.done, 'cw-route cw-route--done');
    line(overlay.todo, 'cw-route-casing');
    line(overlay.todo, `cw-route${overlay.animationKey ? ' cw-route--animate' : ''}`, Boolean(overlay.animationKey));
    if (overlay.preview) {
      line(overlay.preview, 'cw-route-casing');
      line(overlay.preview, 'cw-route cw-route--preview');
    }
    for (const tr of overlay.transitions ?? []) tag(tr, `<span class="cw-label cw-label--route">${iconSvg(poiStyle(tr.kind).icon, 14, tr.kind)}${esc(tr.label)}</span>`);
    if (overlay.start) tag(overlay.start, `<span class="cw-route-start" title="${esc(overlay.start.label)}"></span>`);
    if (overlay.end) {
      const m = L.marker(latLng(overlay.end.x, overlay.end.y), {
        icon: L.divIcon({ className: 'cw-marker cw-marker--poi', html: pinHtml('DESTINATION'), iconSize: [36, 44], iconAnchor: [18, 44] }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 900,
      }).addTo(g.route);
      m.getElement()?.setAttribute('aria-hidden', 'true');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey]);

  // Fit the view to the route when it changes (new route, reroute).
  const fitKey = overlay?.fitKey ?? '';
  useEffect(() => {
    const map = mapRef.current;
    const pts = overlay?.fitPoints;
    if (!map || !fitKey || !pts || pts.length === 0) return;
    autoFit.current = false;
    const b = L.latLngBounds(pts.map((p) => latLng(p.x, p.y)));
    map.fitBounds(b.pad(0.15), { padding: [48, 48], maxZoom: 3, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, planKey]);

  // ───── "you are here" ─────
  const posKey = position ? `${position.x.toFixed(2)}:${position.y.toFixed(2)}:${position.accuracyM}` : '';
  useEffect(() => {
    const map = mapRef.current;
    const g = groups.current;
    if (!map || !g) return;
    g.me.clearLayers();
    if (!position) return;
    L.circle(latLng(position.x, position.y), { radius: Math.max(position.accuracyM, 0.5), className: 'cw-accuracy', interactive: false }).addTo(g.me);
    const me = L.marker(latLng(position.x, position.y), {
      icon: L.divIcon({ className: 'cw-marker', html: '<span class="cw-me"><span class="cw-me__dot"></span></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(g.me);
    me.getElement()?.setAttribute('aria-hidden', 'true');
    if (position.follow) map.panInside(latLng(position.x, position.y), { padding: [96, 96], animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey, position?.follow, planKey]);

  const map = () => mapRef.current;
  const fit = () => {
    const bounds = scope === 'floor' ? plan?.bounds : overview?.bounds;
    if (bounds) map()?.fitBounds(toBounds(bounds), { padding: [24, 24] });
  };

  return (
    <div className={`relative isolate h-full min-h-[22rem] w-full ${onPick ? 'cw-picking' : ''}`}>
      <div ref={host} className="absolute inset-0" />
      {onPick ? (
        <div aria-hidden className="cw-crosshair pointer-events-none absolute start-1/2 top-1/2 z-[450] -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2">
          <svg viewBox="0 0 48 48" className="size-12">
            <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M24 2v12M24 34v12M2 24h12M34 24h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      ) : null}
      <div className="absolute end-3 top-3 z-[500] flex flex-col gap-2">
        <IconButton icon={Plus} label={t('map.zoomIn')} variant="float" onClick={() => {
          autoFit.current = false;
          onUserViewChangeRef.current?.();
          map()?.zoomIn();
        }} />
        <IconButton icon={Minus} label={t('map.zoomOut')} variant="float" onClick={() => {
          autoFit.current = false;
          onUserViewChangeRef.current?.();
          map()?.zoomOut();
        }} />
        <IconButton icon={Locate} label={t('map.recenter')} variant="float" onClick={fit} />
      </div>
          <div className="pointer-events-none absolute start-4 bottom-6 z-[400] flex flex-col items-center rounded-card border border-line bg-card px-2.5 py-1.5 text-sm font-bold text-ink shadow-float">
            <svg aria-hidden viewBox="0 0 12 14" className="size-3.5 text-primary">
              <path d="M6 0l5 14-5-4-5 4z" fill="currentColor" />
            </svg>
            <span aria-hidden className="mt-0.5">N</span>
            <span className="sr-only">{t('map.north')}</span>
          </div>
      </div>
      );
}
