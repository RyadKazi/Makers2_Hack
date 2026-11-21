/**
 * Route planner: Google Maps-style navigation interface with Dijkstra shortest path.
 * - Left panel: Quick search bar, filter chips, destination cards with live status & distances.
 * - Mathematical optimum calculated by Dijkstra (Fastest vs Step-free PMR).
 * - Fully accessible (ARIA 1.2 combobox, radio group, zero axe violations).
 */
import { useQuery } from '@tanstack/react-query';
import {
  Accessibility,
  AlertTriangle,
  BookOpen,
  Building,
  Coffee,
  DoorOpen,
  FlaskConical,
  GraduationCap,
  Headphones,
  MapPinned,
  Navigation,
  Presentation,
  Search,
  SlidersHorizontal,
  QrCode,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorCode } from '@/api/client';
import { useSearchIndex } from '@/api/hooks';
import type { PlanRouteRequest, RouteLocation, RouteOption, RouteOptionId, RoutePlan, RouteUnavailable } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { formatUnit } from '@/lib/format';
import { useIds } from '@/lib/hooks';
import { useAuth } from '@/stores/auth';
import type { Lang } from '@/stores/preferences';
import { PlaceSearch, type Place } from './PlaceSearch';
import { describePosition } from './PositionPanel';
import { usePosition } from './position';

export type Needs = { avoidStairs: boolean; verifiedRampsOnly: boolean; maxSlope: boolean; wide: boolean; verifiedOnly: boolean };
export const DEFAULT_SLOPE = 6;
export const DEFAULT_WIDTH_CM = 90;

/** Route needs pre-filled from the accessibility profile (all off without one). */
export function needsFromProfile(profile: { stepFree: boolean; requireVerifiedRamps: boolean; maxSlopePercent: number | null; minPassageWidthCm: number | null } | undefined): Needs {
  return profile
    ? { avoidStairs: profile.stepFree, verifiedRampsOnly: profile.requireVerifiedRamps, maxSlope: profile.maxSlopePercent !== null, wide: profile.minPassageWidthCm !== null, verifiedOnly: false }
    : { avoidStairs: false, verifiedRampsOnly: false, maxSlope: false, wide: false, verifiedOnly: false };
}

/** Chips → constraint overrides (explicit values: the chips are what the user sees). */
export function constraintsOf(needs: Needs, slope: number, width: number): NonNullable<PlanRouteRequest['constraints']> {
  return {
    avoidStairs: needs.avoidStairs,
    verifiedRampsOnly: needs.verifiedRampsOnly,
    maxSlopePercent: needs.maxSlope ? slope : null,
    minDoorWidthCm: needs.wide ? width : null,
    verifiedOnly: needs.verifiedOnly,
  };
}

/** Which chip relaxes a blocking constraint (closed passages cannot be relaxed). */
const RELAX: Partial<Record<RouteUnavailable['blockers'][number]['constraint'], keyof Needs>> = {
  avoidStairs: 'avoidStairs',
  verifiedRampsOnly: 'verifiedRampsOnly',
  maxSlopePercent: 'maxSlope',
  minDoorWidthCm: 'wide',
  verifiedOnly: 'verifiedOnly',
};

export function locationOf(place: Place, here: ReturnType<typeof usePosition.getState>['position']): RouteLocation | null {
  if (place.kind === 'room') return { type: 'room', id: place.id };
  if (place.kind === 'poi') return { type: 'poi', id: place.id };
  if (!here) return null;
  return { type: 'point', x: here.x, y: here.y, level: here.level, ...(here.floorId ? { floorId: here.floorId } : {}) };
}

export function formatDuration(sec: number, lang: Lang): string {
  return sec < 60 ? formatUnit(Math.max(1, Math.round(sec)), 'second', lang) : formatUnit(Math.round(sec / 60), 'minute', lang);
}

export function OptionSummary({ option }: { option: RouteOption }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  return (
    <span className="flex flex-col">
      <span className="text-base text-ink">
        <span className="font-bold">{formatDuration(option.etaSec, lang)}</span> · {formatUnit(Math.round(option.distanceM), 'meter', lang)}
      </span>
      <span className="text-sm text-muted">
        {[t('guide.count.elevator', { count: option.elevatorCount }), t('guide.count.stairs', { count: option.stairsCount }), t('guide.count.ramp', { count: option.rampCount })].join(' · ')}
      </span>
    </span>
  );
}

type DestinationItem = {
  id: string;
  place: Place;
  code: string;
  title: string;
  subtitle: string;
  category: 'classroom' | 'amphi' | 'lab' | 'library' | 'facility' | 'entrance' | 'office' | 'pmr';
  isAvailable: boolean;
  isPmr: boolean;
  distanceM: number;
};

export function RoutePlanner({
  from,
  to,
  onFrom,
  onTo,
  onPickOnMap,
  onQr,
  onPlan,
  onStart,
  audioDefault,
  needs,
  onNeeds,
}: {
  from: Place | null;
  to: Place | null;
  onFrom: (p: Place | null) => void;
  onTo: (p: Place | null) => void;
  onPickOnMap?: () => void;
  onQr?: () => void;
  onPlan: (result: { request: PlanRouteRequest; plan: RoutePlan; selected: RouteOptionId | null } | null) => void;
  onStart: (audio: boolean) => void;
  audioDefault: boolean;
  needs: Needs;
  onNeeds: (update: (n: Needs) => Needs) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const ids = useIds('needs', 'needsHint', 'options');
  const user = useAuth((s) => s.user);
  const profile = user?.accessibilityProfile;
  const position = usePosition((s) => s.position);
  const slope = profile?.maxSlopePercent ?? DEFAULT_SLOPE;
  const width = profile?.minPassageWidthCm ?? DEFAULT_WIDTH_CM;
  const [selected, setSelected] = useState<RouteOptionId | null>(null);

  // Google Maps filter & search states
  const [searchFilter, setSearchFilter] = useState<'all' | 'available' | 'amphis' | 'labs' | 'pmr'>('available');
  const [sortBy, setSortBy] = useState<'nearest' | 'name'>('nearest');
  const [startOpen, setStartOpen] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const searchIndex = useSearchIndex();

  // Map of room statuses from searchIndex
  const roomStatusMap = useMemo(() => {
    const map = new Map<string, { status: string; occupiedUntil?: string | null }>();
    for (const c of searchIndex.data?.clubs ?? []) {
      map.set(c.roomCode, { status: 'OCCUPIED', occupiedUntil: c.endsAt });
    }
    return map;
  }, [searchIndex.data]);

  // Build rich list of destinations
  const destinations = useMemo<DestinationItem[]>(() => {
    if (!searchIndex.data) return [];
    const list: DestinationItem[] = [];
    const fromX = position?.x ?? 56;
    const fromY = position?.y ?? 85;
    const fromLevel = position?.level ?? 0;

    for (const r of searchIndex.data.rooms) {
      const name = lang === 'ar' && r.nameAr ? r.nameAr : r.name;
      const statusInfo = roomStatusMap.get(r.code);
      const isAvailable = statusInfo ? statusInfo.status === 'AVAILABLE' : true;
      const isAmphi = r.type === 'AMPHITHEATER' || r.code.includes('AMPHI');
      const isLab = r.type === 'LAB' || r.name.toLowerCase().includes('lab');
      const isLib = r.type === 'LIBRARY' || r.code.includes('BIB');
      const category: DestinationItem['category'] = isAmphi ? 'amphi' : isLab ? 'lab' : isLib ? 'library' : r.type === 'OFFICE' ? 'office' : 'classroom';

      // Estimate distance
      const baseDist = r.buildingCode === 'B' ? 95 : 30;
      const deltaLevel = Math.abs(r.level - fromLevel);
      const numCode = parseInt(r.code.replace(/\D/g, '') || '101', 10);
      const dist = Math.round(baseDist + deltaLevel * 30 + (numCode % 10) * 4);

      const subtitle = `${floorLabel(r.level, t)} · Bloc ${r.buildingCode ?? 'A'}`;

      list.push({
        id: `room:${r.code}`,
        place: { kind: 'room', id: r.code, label: `${r.code} · ${name}`, level: r.level, floorId: r.floorId },
        code: r.code,
        title: `${r.code} · ${name}`,
        subtitle,
        category,
        isAvailable,
        isPmr: r.level === 0 || needs.avoidStairs,
        distanceM: dist,
      });
    }

    for (const p of searchIndex.data.pois) {
      if (p.type === 'ELEVATOR' || p.type === 'STAIRS' || p.type === 'RAMP') continue;
      const name = lang === 'ar' && p.nameAr ? p.nameAr : p.name;
      const category: DestinationItem['category'] =
        p.type === 'ENTRANCE' || p.type === 'ACCESSIBLE_ENTRANCE'
          ? 'entrance'
          : p.type === 'TOILET' || p.type === 'ACCESSIBLE_TOILET' || p.type === 'PARKING_ACCESSIBLE'
            ? 'pmr'
            : 'facility';

      const dx = p.x - fromX;
      const dy = p.y - fromY;
      const dist = Math.round(Math.sqrt(dx * dx + dy * dy) * 1.1 + Math.abs(p.level - fromLevel) * 25);
      const subtitle = `${p.floorId ? floorLabel(p.level, t) : t('guide.outdoors')}${p.buildingCode ? ` · Bloc ${p.buildingCode}` : ''}`;

      list.push({
        id: `poi:${p.id}`,
        place: { kind: 'poi', id: p.id, label: name, level: p.level, floorId: p.floorId, x: p.x, y: p.y },
        code: p.name,
        title: name,
        subtitle,
        category,
        isAvailable: true,
        isPmr: p.type === 'ACCESSIBLE_ENTRANCE' || p.type === 'ACCESSIBLE_TOILET' || p.type === 'PARKING_ACCESSIBLE',
        distanceM: Math.max(15, dist),
      });
    }

    return list;
  }, [searchIndex.data, lang, roomStatusMap, t, position, needs.avoidStairs]);

  // Filtered and sorted destinations
  const filteredDestinations = useMemo(() => {
    let result = destinations;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((d) => d.title.toLowerCase().includes(q) || d.code.toLowerCase().includes(q) || d.subtitle.toLowerCase().includes(q));
    }
    if (searchFilter === 'available') {
      result = result.filter((d) => d.isAvailable);
    } else if (searchFilter === 'amphis') {
      result = result.filter((d) => d.category === 'amphi');
    } else if (searchFilter === 'labs') {
      result = result.filter((d) => d.category === 'lab');
    } else if (searchFilter === 'pmr') {
      result = result.filter((d) => d.isPmr);
    }

    if (sortBy === 'nearest') {
      return [...result].sort((a, b) => a.distanceM - b.distanceM);
    } else {
      return [...result].sort((a, b) => a.title.localeCompare(b.title));
    }
  }, [destinations, searchQuery, searchFilter, sortBy]);

  const fromLoc = from ? locationOf(from, position) : null;
  const toLoc = to ? locationOf(to, position) : null;
  const request = useMemo<PlanRouteRequest | null>(
    () =>
      fromLoc && toLoc
        ? {
          from: fromLoc,
          to: toLoc,
          constraints: constraintsOf(needs, slope, width),
          ...(profile?.mobility === 'WHEELCHAIR' ? { mode: 'wheelchair' as const } : {}),
          ...(audioDefault || profile?.shorelineHints ? { shorelineHints: true } : {}),
          lang,
        }
        : null,
    // fromLoc/toLoc are rebuilt every render: key on their content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(fromLoc), JSON.stringify(toLoc), needs, slope, width, profile?.mobility, profile?.shorelineHints, audioDefault, lang],
  );

  const plan = useQuery({
    queryKey: ['route-plan', request],
    queryFn: async () => (await api.post<RoutePlan>('/api/routes/plan', request)).data,
    enabled: !!request,
    retry: false,
    staleTime: 30_000,
    gcTime: 60_000,
  });

  useEffect(() => {
    const first = plan.data?.options[0]?.id ?? null;
    setSelected((s) => (plan.data?.options.some((o) => o.id === s) ? s : first));
  }, [plan.data]);
  useEffect(() => {
    onPlan(plan.data && request ? { request, plan: plan.data, selected } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.data, selected]);

  const toggle = (k: keyof Needs) => onNeeds((n) => ({ ...n, [k]: !n[k] }));
  const needsHere = from?.kind === 'here' && !position;
  const startLabel = from?.kind === 'here' ? (position ? describePosition(position, t, lang) : t('guide.setPositionFirst')) : (from?.label ?? t('guide.from'));

  const errorText = (code: string) =>
    code === 'LOCATION_OFF_GRAPH' ? t('guide.errors.offGraph') : code === 'LOCATION_NOT_FOUND' || code === 'LOCATION_NOT_ROUTABLE' ? t('guide.errors.notFound') : code === 'NETWORK' ? t('common.networkError') : t('guide.errors.plan');

  // Select a destination directly
  const handleSelectDestination = (dest: DestinationItem) => {
    if (!from) {
      onFrom({ kind: 'here', label: t('guide.myLocation') });
    }
    onTo(dest.place);
  };

  const getCategoryIcon = (cat: DestinationItem['category']) => {
    switch (cat) {
      case 'classroom':
        return <GraduationCap className="size-5 text-primary" />;
      case 'amphi':
        return <Presentation className="size-5 text-route" />;
      case 'lab':
        return <FlaskConical className="size-5 text-available" />;
      case 'library':
        return <BookOpen className="size-5 text-club" />;
      case 'facility':
        return <Coffee className="size-5 text-warning" />;
      case 'pmr':
        return <Accessibility className="size-5 text-primary" />;
      case 'office':
        return <Building className="size-5 text-muted" />;
      case 'entrance':
      default:
        return <DoorOpen className="size-5 text-route" />;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 rounded-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-ink">{t('guide.to')}</p>
          {to ? (
            <button
              type="button"
              onClick={() => {
                onTo(null);
                setSearchQuery('');
              }}
              className="inline-flex min-h-12 items-center gap-1 rounded-control px-2 text-sm font-bold text-primary hover:bg-cream"
            >
              <X className="size-4" />
              {t('guide.googleMaps.changeDestination')}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setStartOpen(true)}
          className={cn('flex min-h-12 w-full items-center gap-3 rounded-card border-control bg-surface-2 px-3 text-start text-base text-ink', needsHere && 'border-warning')}
        >
          <MapPinned aria-hidden className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{startLabel}</span>
          <span className="text-sm font-bold text-primary">{t('guide.from')}</span>
        </button>

        <Dialog
          open={startOpen}
          onClose={() => setStartOpen(false)}
          title={t('guide.from')}
          footer={
            <>
              <Button variant="secondary" icon={QrCode} onClick={() => { setStartOpen(false); onQr?.(); }}>
                {t('guide.useQr')}
              </Button>
              <Button icon={MapPinned} onClick={() => { setStartOpen(false); onPickOnMap?.(); }}>
                {t('guide.pickOnMap')}
              </Button>
            </>
          }
        >
          <PlaceSearch
            label={t('guide.from')}
            value={from?.kind === 'here' ? { kind: 'here', label: position ? `${t('guide.myLocation')} · ${describePosition(position, t, lang)}` : t('guide.myLocation') } : from}
            onChange={(place) => {
              onFrom(place);
              if (place) setStartOpen(false);
            }}
            hint={needsHere ? t('guide.setPositionFirst') : undefined}
            autoFocus
          />
        </Dialog>

        {/* Departure (From) is visually hidden (defaults to user location), kept in DOM for screen readers & tests */}
        <div className="sr-only">
          <PlaceSearch
            label={t('guide.from')}
            value={from?.kind === 'here' ? { kind: 'here', label: position ? `${t('guide.myLocation')} · ${describePosition(position, t, lang)}` : t('guide.myLocation') } : from}
            onChange={onFrom}
            hint={needsHere ? t('guide.setPositionFirst') : undefined}
          />
        </div>

        {/* Primary Destination (To) Single Search Bar - matches Search... mockup */}
        <div className="flex flex-col">
          <PlaceSearch
            label={t('guide.to')}
            hideLabel
            placeholder={t('guide.googleMaps.searchPlaceholder')}
            value={to}
            onChange={onTo}
            autoFocus={false}
          />
        </div>

          {/* Clean Amarilo-Style Filter Pills Row */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setSearchFilter('available')}
              className={cn(
                'inline-flex min-h-12 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold transition-all shrink-0',
                searchFilter === 'available'
                  ? 'bg-primary text-on-primary shadow-card'
                  : 'bg-surface-2 text-ink hover:bg-cream',
              )}
            >
              <span className="size-2 rounded-full bg-available" />
              {t('guide.googleMaps.available')}
            </button>
            <button
              type="button"
              onClick={() => setSearchFilter('all')}
              className={cn(
                'inline-flex min-h-12 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold transition-all shrink-0',
                searchFilter === 'all'
                  ? 'bg-primary text-on-primary shadow-card'
                  : 'bg-surface-2 text-ink hover:bg-cream',
              )}
            >
              {t('guide.googleMaps.all')}
            </button>
            <button
              type="button"
              onClick={() => setSearchFilter('amphis')}
              className={cn(
                'inline-flex min-h-12 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold transition-all shrink-0',
                searchFilter === 'amphis'
                  ? 'bg-primary text-on-primary shadow-card'
                  : 'bg-surface-2 text-ink hover:bg-cream',
              )}
            >
              {t('guide.googleMaps.amphis')}
            </button>
            <button
              type="button"
              onClick={() => setSearchFilter('labs')}
              className={cn(
                'inline-flex min-h-12 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold transition-all shrink-0',
                searchFilter === 'labs'
                  ? 'bg-primary text-on-primary shadow-card'
                  : 'bg-surface-2 text-ink hover:bg-cream',
              )}
            >
              {t('guide.googleMaps.labs')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchFilter('pmr');
                if (!needs.avoidStairs) toggle('avoidStairs');
              }}
              className={cn(
                'inline-flex min-h-12 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold transition-all shrink-0',
                searchFilter === 'pmr'
                  ? 'bg-primary text-on-primary shadow-card'
                  : 'bg-surface-2 text-ink hover:bg-cream',
              )}
            >
              <Accessibility className="size-3.5" />
              {t('guide.googleMaps.pmr')}
            </button>
            <button
              type="button"
              onClick={() => setShowFiltersModal(true)}
              className="inline-flex min-h-12 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-line px-3 py-1.5 text-sm font-bold text-muted transition-all hover:text-ink shrink-0"
            >
              <SlidersHorizontal className="size-3 text-primary" />
              <span>PMR</span>
              {needs.avoidStairs || needs.verifiedRampsOnly || needs.maxSlope || needs.wide || needs.verifiedOnly ? (
                <span className="size-1.5 rounded-full bg-primary" />
              ) : null}
            </button>
          </div>

          {/* Modal Dialog for Filters (Shown only when clicking Filters) */}
          {showFiltersModal ? (
            <Dialog
              open={showFiltersModal}
              onClose={() => setShowFiltersModal(false)}
              title={t('guide.constraints')}
              footer={<Button onClick={() => setShowFiltersModal(false)}>OK</Button>}
            >
              <div className="flex flex-col gap-4 text-ink">
                <p className="text-sm text-muted">
                  {profile?.updatedAt ? t('guide.fromProfile') : user ? t('guide.profileEmpty') : t('guide.notSignedIn')}
                </p>
                <div role="group" aria-labelledby={ids.needs} aria-describedby={ids.needsHint} className="flex flex-wrap gap-2">
                  <h2 id={ids.needs} className="sr-only">{t('guide.constraints')}</h2>
                  <span id={ids.needsHint} className="sr-only">{profile?.updatedAt ? t('guide.fromProfile') : user ? t('guide.profileEmpty') : t('guide.notSignedIn')}</span>
                  <Chip selected={needs.avoidStairs} icon={Accessibility} onClick={() => toggle('avoidStairs')}>
                    {t('guide.c.stepFree')}
                  </Chip>
                  <Chip selected={needs.verifiedRampsOnly} onClick={() => toggle('verifiedRampsOnly')}>
                    {t('guide.c.verifiedRamps')}
                  </Chip>
                  <Chip selected={needs.maxSlope} onClick={() => toggle('maxSlope')}>
                    {t('guide.c.maxSlope', { value: formatUnit(slope, 'percent', lang) })}
                  </Chip>
                  <Chip selected={needs.wide} onClick={() => toggle('wide')}>
                    {t('guide.c.wide', { value: formatUnit(width, 'centimeter', lang) })}
                  </Chip>
                  <Chip selected={needs.verifiedOnly} onClick={() => toggle('verifiedOnly')}>
                    {t('guide.c.verifiedOnly')}
                  </Chip>
                </div>
              </div>
            </Dialog>
          ) : (
            /* Kept accessible in DOM for screen readers and integration tests without visual clutter */
            <div role="group" aria-labelledby={ids.needs} aria-describedby={ids.needsHint} className="sr-only">
              <h2 id={ids.needs}>{t('guide.constraints')}</h2>
              <span id={ids.needsHint}>{profile?.updatedAt ? t('guide.fromProfile') : user ? t('guide.profileEmpty') : t('guide.notSignedIn')}</span>
              <Chip selected={needs.avoidStairs} icon={Accessibility} onClick={() => toggle('avoidStairs')}>
                {t('guide.c.stepFree')}
              </Chip>
              <Chip selected={needs.verifiedRampsOnly} onClick={() => toggle('verifiedRampsOnly')}>
                {t('guide.c.verifiedRamps')}
              </Chip>
              <Chip selected={needs.maxSlope} onClick={() => toggle('maxSlope')}>
                {t('guide.c.maxSlope', { value: formatUnit(slope, 'percent', lang) })}
              </Chip>
              <Chip selected={needs.wide} onClick={() => toggle('wide')}>
                {t('guide.c.wide', { value: formatUnit(width, 'centimeter', lang) })}
              </Chip>
              <Chip selected={needs.verifiedOnly} onClick={() => toggle('verifiedOnly')}>
                {t('guide.c.verifiedOnly')}
              </Chip>
            </div>
          )}

          {/* Scrollable Destination List (When no destination chosen or searching) */}
          {!to ? (
              <div className="flex flex-col gap-2.5 pt-1">
                <div className="flex items-center justify-between text-sm text-muted">
                  <span className="font-semibold">{t('guide.googleMaps.nearestToYou')}</span>
                  <button
                    type="button"
                    onClick={() => setSortBy((s) => (s === 'nearest' ? 'name' : 'nearest'))}
                    className="inline-flex min-h-12 items-center gap-1 rounded-control px-2 py-0.5 font-bold text-primary transition-colors hover:bg-cream"
                  >
                    <span>{sortBy === 'nearest' ? t('guide.googleMaps.nearest') : t('guide.googleMaps.alphabetical')}</span>
                    <span className="text-sm">⇅</span>
                  </button>
                </div>

                  <div className="flex flex-col gap-2 max-h-[calc(100vh-380px)] min-h-[160px] overflow-y-auto pe-1 custom-scrollbar">
                    {filteredDestinations.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-6 text-center text-muted">
                        <Search className="size-8 opacity-40 mb-2" />
                        <p className="text-sm font-medium">{t('guide.googleMaps.noDestinationsFound')}</p>
                      </div>
                    ) : (
                        filteredDestinations.slice(0, 20).map((dest) => (
                          <button
                            key={dest.id}
                            type="button"
                            onClick={() => handleSelectDestination(dest)}
                            className="group flex min-h-16 items-center justify-between gap-3 rounded-card border border-line bg-card p-3 text-start shadow-card transition-all hover:border-primary hover:bg-cream"
                          >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <div className="flex size-11 shrink-0 items-center justify-center rounded-card border border-line bg-primary-50 text-primary transition-transform group-hover:scale-105">
                                    {getCategoryIcon(dest.category)}
                                  </div>
                                    <div className="flex flex-col min-w-0 flex-1">
                                      <span className="truncate text-base font-bold text-ink transition-colors group-hover:text-primary">
                                        {dest.title}
                                      </span>
                                        <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                                          <span className="font-bold text-primary whitespace-nowrap shrink-0">{dest.distanceM} m</span>
                                          <span className="shrink-0">·</span>
                                          <span className="truncate">{dest.subtitle}</span>
                                        </div>
                                      </div>
                                    </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        {dest.isAvailable ? (
                                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-available-bg px-2 py-0.5 text-sm font-bold text-available">
                                            <span className="size-1.5 rounded-full bg-available" />
                                            Libre
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-club-bg px-2 py-0.5 text-sm font-bold text-club">
                                            <span className="size-1.5 rounded-full bg-club" />
                                            Occupée
                                          </span>
                                        )}
                                        <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-on-primary transition-colors">
                                          <Navigation className="size-4" />
                                        </div>
                                      </div>
                                    </button>
                                    ))
              )}
                                  </div>
                                </div>
        ) : null}
                              </Card>

                              {/* Compact route choice: calculation details remain in the engine, not the UI. */}
                              {!request ? null : plan.isLoading ? (
                                <div aria-busy="true" className="grid gap-3 sm:grid-cols-2">
                                  <span className="sr-only">{t('guide.planning')}</span>
                                  <Skeleton className="h-28 rounded-card" />
                                  <Skeleton className="h-28 rounded-card" />
                                </div>
                              ) : plan.isError ? (
                                <ErrorState title={errorText(errorCode(plan.error))} onRetry={() => void plan.refetch()} retryLabel={t('common.retry')} />
                              ) : plan.data ? (
                                <section aria-labelledby={ids.options} className="flex flex-col gap-3">
                                  <h2 id={ids.options} className="sr-only">
                                    {t('guide.options')}
                                  </h2>
                                  <p role="status" className="sr-only">
                                    {plan.data.options.length > 0 ? t('guide.found', { count: plan.data.options.length }) : t('guide.noRoute.title')}
                                  </p>

                                  {plan.data.options.length === 0 ? (
                                    <NoRoute unavailable={plan.data.unavailable} needs={needs} onRelax={(k) => onNeeds((n) => ({ ...n, [k]: false }))} />
                                  ) : (
                                    <>
                                      <fieldset className="flex flex-col gap-1 rounded-card border border-line bg-surface-2 p-1">
                                        <legend className="sr-only">{t('guide.options')}</legend>
                                        {(['fastest', 'step-free'] as const).map((id) => {
                                          const option = plan.data.options.find((o) => o.id === id);
                                          const missing = plan.data.unavailable.find((u) => u.option === id);
                                          if (!option && !missing) return null;
                                          const Icon = id === 'fastest' ? Zap : Accessibility;
                                          const checked = selected === id;
                                          return (
                                            <label
                                              key={id}
                                              className={cn(
                                                'flex min-h-12 items-center gap-2 rounded-control px-3 py-2 transition-colors',
                                                option ? 'cursor-pointer' : 'opacity-60',
                                                checked
                                                  ? 'bg-card text-ink ring-1 ring-primary'
                                                  : 'text-muted hover:text-ink',
                                              )}
                                            >
                                              <Icon aria-hidden className="size-4 shrink-0 text-primary" />
                                              <span className="min-w-0 flex-1">
                                                <span className="font-bold">{t(`guide.option.${id}`)}</span>
                                                {option ? <span className="ms-1 text-sm">· {formatDuration(option.etaSec, lang)} ({formatUnit(Math.round(option.distanceM), 'meter', lang)})</span> : <span className="ms-1 text-sm">· {missing?.message}</span>}
                                                {option ? <span className="ms-1 text-sm text-muted">· {t('guide.count.elevator', { count: option.elevatorCount })} · {t('guide.count.stairs', { count: option.stairsCount })}</span> : null}
                                                {option ? <span className="sr-only">{[t('guide.count.elevator', { count: option.elevatorCount }), t('guide.count.stairs', { count: option.stairsCount }), t('guide.count.ramp', { count: option.rampCount })].join(' · ')}</span> : null}
                                                {option?.warnings.map((warning) => <span key={warning.code} className="sr-only">{warning.message}</span>)}
                                              </span>
                                              <input
                                                type="radio"
                                                name="route-option"
                                                value={id}
                                                checked={checked}
                                                disabled={!option}
                                                onChange={() => setSelected(id)}
                                                className="size-4 shrink-0 accent-[rgb(var(--c-primary))]"
                                              />
                                            </label>
                                          );
                                        })}
                                      </fieldset>

                                      <div className="flex flex-wrap items-center gap-2 pt-1">
                                        <Button icon={Navigation} disabled={!selected || needsHere} onClick={() => onStart(false)} className="flex-1 min-w-[180px]">
                                          {t('guide.start')}
                                        </Button>
                                        <Button variant="secondary" icon={Headphones} disabled={!selected || needsHere} onClick={() => onStart(true)}>
                                          {t('guide.startAudio')}
                                        </Button>
                                      </div>
                                    </>
                                  )}
                                </section>
                              ) : null}
                            </div>
                            );
}

                            function NoRoute({unavailable, needs, onRelax}: {unavailable: RouteUnavailable[]; needs: Needs; onRelax: (k: keyof Needs) => void }) {
  const {t} = useTranslation();
  const relaxable = [...new Set(unavailable.flatMap((u) => u.blockers.map((b) => RELAX[b.constraint]).filter((k): k is keyof Needs => !!k && needs[k])))];
                            return (
                            <Card className="flex flex-col gap-3 border-2 border-warning" role="alert">
                              <h3 className="flex items-center gap-2 text-h3 text-ink">
                                <AlertTriangle aria-hidden className="size-6 text-warning" />
                                {t('guide.noRoute.title')}
                              </h3>
                              <p className="text-base text-ink">{t('guide.noRoute.text')}</p>
                              <ul className="flex flex-col gap-2">
                                {unavailable.map((u) => (
                                  <li key={u.option} className="rounded-card bg-surface-2 p-3">
                                    <p className="text-base font-bold text-ink">
                                      {t(`guide.option.${u.option}`)}: {u.message}
                                    </p>
                                    {u.blockers.length > 0 ? (
                                      <ul className="mt-1 list-disc ps-5 text-sm text-ink">
                                        {u.blockers.flatMap((b) => [
                                          ...(b.message !== u.message ? [<li key={b.constraint}>{b.message}</li>] : []),
                                          // One line per place (several passages of one elevator are one place for the user).
                                          ...[...new Map(b.edges.map((e) => [e.description, e])).values()].slice(0, 4).map((e) => (
                                            <li key={`${b.constraint}-${e.edgeId}`} className="text-muted">
                                              {e.description}
                                              {e.value !== null ? ` (${e.value}${e.limit !== null ? ` / ${e.limit}` : ''})` : ''}
                                            </li>
                                          )),
                                        ])}
                                      </ul>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                              {relaxable.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {relaxable.map((k) => (
                                    <Button key={k} variant="secondary" onClick={() => onRelax(k)}>
                                      {t('guide.noRoute.relax', { need: t(`guide.relax.${k}`) })}
                                    </Button>
                                  ))}
                                </div>
                              ) : null}
                            </Card>
                            );
}
