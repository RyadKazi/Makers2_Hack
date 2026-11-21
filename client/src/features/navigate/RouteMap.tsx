/**
 * The plan with the route on it: one floor (or the outdoors) at a time, with
 * chips for every floor the route crosses. Walked part muted, the rest in the
 * route colour, a proposed reroute dashed, "you are here" with its accuracy.
 */
import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBuildings, useCampusOverview, useFloorPlan } from '@/api/hooks';
import { Skeleton } from '@/components/ui/Feedback';
import { FloorMap, type MapItem, type MapOverlay, type MapPosition, type XYPoint } from '@/features/map/FloorMap';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { useMapPrefs } from '@/stores/mapPrefs';
import { usePreferences } from '@/stores/preferences';
import type { Position } from './position';
import { splitForFloor, transitionsOnFloor, type Track } from './routeModel';

/** null = outdoors. */
export type FloorRef = { floorId: string | null; level: number };

export const floorKeyOf = (f: FloorRef): string => f.floorId ?? 'outdoors';

/** Floors (and the outdoors) crossed by the route, in walking order. */
export function routeFloors(track: Track | null): FloorRef[] {
  const seen = new Map<string, FloorRef>();
  for (const p of track?.points ?? []) {
    const ref = { floorId: p.floorId, level: p.level };
    if (!seen.has(floorKeyOf(ref))) seen.set(floorKeyOf(ref), ref);
  }
  return [...seen.values()];
}

export function useFloorName() {
  const { t, i18n } = useTranslation();
  const buildings = useBuildings();
  return (f: FloorRef): string => {
    if (!f.floorId) return t('guide.outdoors');
    const b = buildings.data?.items.find((x) => x.floors.some((fl) => fl.id === f.floorId));
    const name = b ? (i18n.language === 'ar' ? b.nameAr : b.name) : '';
    return name ? `${name} · ${floorLabel(f.level, t)}` : floorLabel(f.level, t);
  };
}

export function RouteMap({
  track,
  d,
  preview,
  view,
  onView,
  position,
  follow,
  onPick,
  onSelect,
  label,
  describedBy,
  routeKey,
  animateRoute = false,
  className,
}: {
  track: Track | null;
  d: number;
  preview?: Track | null;
  view: FloorRef | null;
  onView: (f: FloorRef) => void;
  position: Position | null;
  follow: boolean;
  onPick?: ((p: XYPoint) => void) | null;
  onSelect?: (item: MapItem) => void;
  label: string;
  describedBy: string;
  routeKey: string;
  /** Planner previews can play each floor segment in sequence without altering routing state. */
  animateRoute?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const layers = useMapPrefs((s) => s.layers);
  const floorName = useFloorName();
  const buildings = useBuildings();
  const preferredFloorId = usePreferences((s) => s.floorId);

  const allFloors = useMemo<FloorRef[]>(
    () => [...(buildings.data?.items.flatMap((b) => b.floors.map((f) => ({ floorId: f.id, level: f.level }))) ?? []), { floorId: null, level: 0 }],
    [buildings.data],
  );

  const floors = useMemo(() => routeFloors(track), [track]);
  const [playIndex, setPlayIndex] = useState<number | null>(null);
  const [playKey, setPlayKey] = useState(0);

  const replay = () => {
    if (!floors.length) return;
    setPlayKey((key) => key + 1);
    setPlayIndex(0);
  };

  // A route preview advances one isolated floor/outdoor segment at a time. That
  // guarantees its geometry stays within the active plan, including between blocs.
  useEffect(() => {
    if (!animateRoute || !floors.length) return undefined;
    setPlayIndex(0);
    return undefined;
  }, [animateRoute, routeKey, floors.length]);
  useEffect(() => {
    if (playIndex === null || playIndex >= floors.length - 1) return undefined;
    const timer = window.setTimeout(() => setPlayIndex((current) => (current === null ? null : current + 1)), 1550);
    return () => window.clearTimeout(timer);
  }, [playIndex, floors.length, playKey]);

  // Default to user's preferred floor or Bloc A ground floor so the map is never empty
  const defaultFloor = useMemo<FloorRef | null>(() => {
    if (preferredFloorId) {
      const match = allFloors.find((f) => f.floorId === preferredFloorId);
      if (match) return match;
    }
    return allFloors.find((f) => f.floorId && f.level === 0) ?? allFloors[0] ?? null;
  }, [allFloors, preferredFloorId]);

  const playingFloor = playIndex === null ? null : floors[playIndex];
  const shown = playingFloor ?? view ?? floors[0] ?? defaultFloor;
  const outdoors = shown !== null && shown.floorId === null;
  const plan = useFloorPlan(shown && !outdoors ? shown.floorId : null);
  const overview = useCampusOverview(outdoors);

  const overlay = useMemo<MapOverlay | null>(() => {
    if (!track || !shown) return null;
    const key = { level: shown.level, floorId: shown.floorId, outdoors };
    const { done, todo } = splitForFloor(track, d, key);
    const first = track.points[0]!;
    const last = track.points.at(-1)!;
    const here = (p: { floorId: string | null; level: number }) => (outdoors ? p.floorId === null : p.floorId === shown.floorId);
    const onFloor = track.points.filter(here);
    return {
      done,
      todo,
      preview: preview ? splitForFloor(preview, 0, key).todo : [],
      transitions: transitionsOnFloor(track, shown.floorId).map((tr) => ({ x: tr.x, y: tr.y, kind: tr.kind, label: `${t(`poiType.${tr.kind}`)} → ${floorLabel(tr.toLevel, t)}` })),
      start: here(first) ? { x: first.x, y: first.y, label: t('guide.from') } : null,
      end: here(last) ? { x: last.x, y: last.y, label: t('guide.to') } : null,
      fitKey: `${routeKey}:${floorKeyOf(shown)}`,
      fitPoints: [...onFloor, ...(preview ? preview.points.filter(here) : [])],
      animationKey: playingFloor ? `${routeKey}:${playKey}:${floorKeyOf(shown)}` : undefined,
    };
  }, [track, preview, d, shown, outdoors, routeKey, t, playingFloor, playKey]);

  const me: MapPosition | null =
    position && shown && (outdoors ? position.floorId === null : position.floorId === shown.floorId || (position.floorId === null && position.level === shown.level && !outdoors))
      ? { x: position.x, y: position.y, accuracyM: position.accuracyM, follow }
      : null;

  const loading = outdoors ? !overview.data : !!shown && !plan.data;

  return (
      <div className={cn('relative h-full w-full', className)}>
        {track && animateRoute ? (
          <button
            type="button"
            onClick={replay}
            className="absolute start-3 top-3 z-[460] inline-flex min-h-12 items-center gap-1.5 rounded-control border border-line bg-card px-2.5 text-sm font-bold text-ink shadow-card hover:bg-surface-2 focus-visible:outline focus-visible:outline-3 focus-visible:outline-focus"
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Replay
          </button>
        ) : null}
        {floors.length > 1 ? (
            <div role="group" aria-label={t('guide.floorsOnRoute')} className="absolute end-4 top-4 z-[450] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1 rounded-control border border-line bg-card p-1 shadow-card">
              {floors.map((f) => {
                const active = shown !== null && floorKeyOf(f) === floorKeyOf(shown);
                return (
                  <button
                    key={floorKeyOf(f)}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setPlayIndex(null);
                      onView(f);
                    }}
                    className={cn('min-h-12 rounded-lg px-2 text-sm font-bold transition-colors', active ? 'bg-primary text-on-primary' : 'text-ink hover:bg-surface-2')}
                  >
                    {floorName(f)}
                  </button>
                );
              })}
            </div>
      ) : null}
              <div className="relative size-full overflow-hidden rounded-card border border-line bg-card">
                {loading ? <Skeleton className="absolute inset-0" /> : null}
                <FloorMap
                  scope={outdoors ? 'campus' : 'floor'}
                  plan={outdoors ? undefined : plan.data}
                  overview={outdoors ? overview.data : undefined}
                  layers={layers}
                  selected={null}
                  onSelect={onSelect ?? (() => undefined)}
                  label={shown ? `${label} — ${floorName(shown)}` : label}
                  describedBy={describedBy}
                  overlay={overlay}
                  position={me}
                  onPick={onPick ?? null}
                  onUserViewChange={() => setPlayIndex(null)}
                />
              </div>
            </div>
            );
}
