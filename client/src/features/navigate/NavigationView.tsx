/**
 * Visual guidance: big instruction bar (current step, what comes next, time and
 * distance left, Stop), the map following the position with automatic floor
 * switching, the step list with progress (side column on desktop), reroute alerts.
 */
import { AlertTriangle, Clock, Headphones, Route as RouteIcon, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { XYPoint } from '@/features/map/FloorMap';
import { SharingControl } from '@/features/sharing/SharingControl';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { formatNumber, formatUnit } from '@/lib/format';
import { useTier } from '@/lib/hooks';
import type { Lang } from '@/stores/preferences';
import { useNav } from './navStore';
import { usePosition } from './position';
import { PositionPanel } from './PositionPanel';
import { ReportProblem } from './ReportProblem';
import { formatDuration } from './RoutePlanner';
import { floorKeyOf, RouteMap, type FloorRef } from './RouteMap';
import { buildTrack, metresToNextStep } from './routeModel';
import { stepIcon } from './stepIcons';

export function remainingOf(option: { distanceM: number; etaSec: number }, totalM: number, d: number): { metres: number; seconds: number } {
  const metres = Math.max(0, totalM - d);
  return { metres, seconds: totalM > 0 ? (option.etaSec * metres) / totalM : 0 };
}

/** Pending reroute / no route alert (role=alert: read at once). */
export function PendingAlert({ onAccept, onRetry, onChange, big = false }: { onAccept: () => void; onRetry: () => void; onChange: () => void; big?: boolean }) {
  const { t } = useTranslation();
  const pending = useNav((s) => s.pending);
  if (!pending) return null;
  return (
    <div role="alert" className={cn('flex flex-col gap-3 rounded-card border-2 border-warning bg-warning-bg p-4 text-ink', big && 'p-6')}>
      <p className={cn('flex items-start gap-2 font-bold', big ? 'text-2xl' : 'text-h3')}>
        <AlertTriangle aria-hidden className={cn('mt-1 shrink-0 text-warning', big ? 'size-8' : 'size-6')} />
        <span>
          {pending.kind === 'reroute' ? t('guide.reroute.title') : t('guide.noRouteNow.title')}
          <span className={cn('block font-normal', big ? 'text-xl' : 'text-base')}>{pending.message}</span>
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {pending.kind === 'reroute' ? (
          <Button size="lg" onClick={onAccept} className={big ? 'min-h-20 w-full text-2xl' : ''}>
            {t('guide.reroute.accept')}
          </Button>
        ) : (
          <>
            <Button size="lg" onClick={onRetry} className={big ? 'min-h-20 text-2xl' : ''}>
              {t('guide.noRouteNow.retry')}
            </Button>
            <Button size="lg" variant="secondary" onClick={onChange} className={big ? 'min-h-20 text-2xl' : ''}>
              {t('guide.noRouteNow.change')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function StepList({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const option = useNav((s) => s.option);
  const track = useNav((s) => s.track);
  const stepIndex = useNav((s) => s.stepIndex);
  const d = useNav((s) => s.d);
  const phase = useNav((s) => s.phase);
  const current = useRef<HTMLLIElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // Keep the current step visible by scrolling the list only (never the page).
  useEffect(() => {
    const ol = list.current;
    const li = current.current;
    if (!ol || !li || ol.scrollHeight <= ol.clientHeight) return;
    const top = li.offsetTop - ol.offsetTop;
    if (top < ol.scrollTop || top + li.offsetHeight > ol.scrollTop + ol.clientHeight) ol.scrollTop = Math.max(0, top - 8);
  }, [stepIndex]);
  if (!option || !track) return null;
  const steps = option.steps.filter((s) => s.type !== 'START');
  return (
    <ol ref={list} className={cn('relative flex flex-col gap-1 py-1', compact && 'max-h-[22rem] overflow-y-auto')}>
      {steps.map((s) => {
        const Icon = stepIcon(s);
        const isCurrent = phase === 'navigating' && s.index === stepIndex;
        const done = phase === 'arrived' || (track.stepStart[s.index + 1] ?? Infinity) <= d;
        const vertical = s.type === 'ELEVATOR' || s.type === 'STAIRS';
        const sub = s.type === 'ARRIVE' ? (s.floorId ? floorLabel(s.level, t) : t('guide.outdoors')) : vertical && s.toLevel !== null ? `→ ${floorLabel(s.toLevel, t)}` : s.shoreline ? t(`guide.where.shoreline.${s.shoreline.side}`, { feature: t(`guide.where.feature.${s.shoreline.feature}`) }) : null;
        return (
          <li
            key={s.index}
            ref={isCurrent ? current : undefined}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn('flex min-h-14 shrink-0 items-center gap-3 rounded-control p-2', isCurrent && 'border-s-4 border-primary bg-primary-50 hc:border-primary', done && !isCurrent && 'opacity-70')}
          >
            <span aria-hidden className={cn('inline-flex size-12 shrink-0 items-center justify-center rounded-control', s.type === 'ARRIVE' ? 'bg-available-bg text-available' : 'bg-primary-50 text-primary', 'hc:border-2 hc:border-white')}>
              <Icon className="size-6" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-bold text-ink">
                {isCurrent ? <span className="sr-only">{t('guide.current')}: </span> : done ? <span className="sr-only">{t('guide.done')}: </span> : null}
                {s.instruction}
              </span>
              {sub ? <span className="text-sm text-muted">{sub}</span> : null}
            </span>
            {!vertical && s.distanceM > 0 ? <span className="shrink-0 text-sm font-bold text-muted tabular-nums">{formatUnit(Math.round(s.distanceM), 'meter', lang)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function RouteProgress() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const option = useNav((s) => s.option);
  const track = useNav((s) => s.track);
  const d = useNav((s) => s.d);
  const label = useNav((s) => s.destinationLabel);
  if (!option || !track) return null;
  const { metres, seconds } = remainingOf(option, track.total, d);
  const percent = track.total > 0 ? Math.min(100, Math.round((d / track.total) * 100)) : 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3 text-ink">{t('guide.toPlace', { place: label })}</h2>
        <span className="text-base font-bold text-ink tabular-nums">
          {formatDuration(seconds, lang)} ({formatUnit(Math.round(metres), 'meter', lang)})
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t('guide.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t('guide.progressValue', { percent: formatNumber(percent / 100, lang, { style: 'percent' }) })}
        className="h-3 overflow-hidden rounded-full bg-surface-2 hc:border hc:border-white"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function InstructionBar({ onStop }: { onStop: () => void }) {
  const ref = useRef<HTMLElement>(null);
  // Guidance starts here: page back to the top, focus on the instruction (keyboard / screen reader).
  useEffect(() => {
    document.getElementById('main')?.scrollTo?.({ top: 0 });
    document.scrollingElement?.scrollTo?.({ top: 0 });
    ref.current?.focus({ preventScroll: true });
  }, []);
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const option = useNav((s) => s.option);
  const track = useNav((s) => s.track);
  const stepIndex = useNav((s) => s.stepIndex);
  const d = useNav((s) => s.d);
  const offRouteM = useNav((s) => s.offRouteM);
  if (!option || !track) return null;
  const step = option.steps.find((s) => s.index === stepIndex) ?? option.steps[0]!;
  const next = option.steps.find((s) => s.index === stepIndex + 1);
  const Icon = stepIcon(step);
  const left = metresToNextStep(track, step.index, d);
  const { metres, seconds } = remainingOf(option, track.total, d);
  return (
    <section ref={ref} tabIndex={-1} aria-label={t('guide.instruction')} className="card-interactive flex flex-col gap-3 rounded-card bg-ink p-5 text-canvas shadow-float desk:flex-row desk:items-center desk:gap-5 desk:p-6 hc:border-2 hc:border-white animate-fade-in">
      <div className="flex min-w-0 grow items-center gap-4">
        <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
          <Icon className="size-8" />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-bold desk:text-2xl">{step.instruction}</p>
          <p className="text-base opacity-90">
            {step.type !== 'ARRIVE' ? t('guide.metresLeft', { distance: formatUnit(Math.round(left), 'meter', lang) }) : null}
            {next && next.type !== 'ARRIVE' ? ` ${t('guide.then', { instruction: next.instruction })}` : null}
          </p>
          {offRouteM !== null && offRouteM > 8 ? <p className="mt-1 text-base font-bold">{t('guide.offRouteBy', { distance: formatUnit(Math.round(offRouteM), 'meter', lang) })}</p> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-4 desk:border-s desk:border-canvas/30 desk:ps-5">
        <span className="flex items-center gap-2">
          <Clock aria-hidden className="size-6" />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-bold tabular-nums">{formatDuration(seconds, lang)}</span>
            <span className="text-sm opacity-90">{t('guide.remaining')}</span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <RouteIcon aria-hidden className="size-6" />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-bold tabular-nums">{formatUnit(Math.round(metres), 'meter', lang)}</span>
            <span className="text-sm opacity-90">{t('guide.toDestination')}</span>
          </span>
        </span>
        <Button variant="danger-outline" icon={Square} onClick={onStop} className="ms-auto">
          {t('guide.stop')}
        </Button>
      </div>
    </section>
  );
}

export function NavigationView({ onStop, onAudio, onAccept, onRetry, onChange, onWrongTurn }: { onStop: () => void; onAudio: () => void; onAccept: () => void; onRetry: () => void; onChange: () => void; onWrongTurn: () => void }) {
  const { t } = useTranslation();
  const tier = useTier();
  const track = useNav((s) => s.track);
  const d = useNav((s) => s.d);
  const version = useNav((s) => s.version);
  const routeId = useNav((s) => s.routeId);
  const pending = useNav((s) => s.pending);
  const position = usePosition((s) => s.position);
  const setPosition = usePosition((s) => s.set);
  const [manualView, setManualView] = useState<FloorRef | null>(null);
  const [picking, setPicking] = useState(false);
  const preview = useMemo(() => (pending?.kind === 'reroute' ? buildTrack(pending.route, { ...pending.route.steps[0]!, floorId: pending.route.steps[0]!.floorId }) : null), [pending]);

  // Automatic floor switching: the map follows the floor you are on (elevators, stairs).
  const auto: FloorRef | null = position ? { floorId: position.floorId, level: position.level } : null;
  const autoKey = auto ? floorKeyOf(auto) : '';
  useEffect(() => setManualView(null), [autoKey]);
  const view = manualView ?? auto;

  const onPick = (p: XYPoint) => {
    const f = view ?? (track ? { floorId: track.points[0]!.floorId, level: track.points[0]!.level } : null);
    if (!f) return;
    setPosition({ x: p.x, y: p.y, level: f.level, floorId: f.floorId, accuracyM: 3, source: 'map', label: null });
    useNav.getState().setSim({ active: false });
    setPicking(false);
  };

  const map = (
    <div className="flex flex-col gap-2">
      {picking ? (
        <p id="nav-pick-help" className="flex flex-wrap items-center gap-2 rounded-control bg-primary-50 p-3 text-base text-ink">
          {t('guide.pick.banner')}
          <Button variant="secondary" onClick={() => setPicking(false)}>
            {t('guide.pick.cancel')}
          </Button>
        </p>
      ) : (
        <p id="nav-map-help" className="sr-only">
          {t('guide.mapHelp')}
        </p>
      )}
      <RouteMap
        track={track}
        d={d}
        preview={preview}
        view={view}
        onView={setManualView}
        position={position}
        follow={!manualView && !picking}
        onPick={picking ? onPick : null}
        label={t('guide.mapLabel')}
        describedBy={picking ? 'nav-pick-help' : 'nav-map-help'}
        routeKey={`${routeId}:${version}`}
        className={tier === 'desktop' ? 'h-[calc(100dvh-24rem)] min-h-[24rem]' : 'h-[50dvh] min-h-[20rem]'}
      />
      {manualView ? (
        <Button variant="secondary" onClick={() => setManualView(null)}>
          {t('guide.backToMe')}
        </Button>
      ) : null}
    </div>
  );

  const side = (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <RouteProgress />
        <h3 className="sr-only">{t('guide.stepsTitle')}</h3>
        <StepList compact={tier === 'desktop'} />
      </Card>
      <ReportProblem routeId={routeId} />
      <Button variant="secondary" icon={Headphones} onClick={onAudio} fullWidth>
        {t('guide.audio.switch')}
      </Button>
      <Card>
        <PositionPanel onPickOnMap={() => setPicking(true)} navigating onWrongTurn={onWrongTurn} />
      </Card>
      <Card>
        <h2 className="mb-2 text-h3 text-ink">{t('sharing.title')}</h2>
        <SharingControl />
      </Card>
    </div>
  );

  const bar = <InstructionBar onStop={onStop} />;
  const alert = <PendingAlert onAccept={onAccept} onRetry={onRetry} onChange={onChange} />;

  if (tier === 'desktop') {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_24rem] gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {alert}
          {map}
          {bar}
        </div>
        {side}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {bar}
      {alert}
      {map}
      {side}
    </div>
  );
}
