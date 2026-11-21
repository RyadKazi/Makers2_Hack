/**
 * Navigate: plan → guide (visual or audio) → arrive.
 * Deep links: /navigate?to=room:A-104  ?from=poi:<id>  ?at=poi:<id> (QR checkpoint link)  ?mode=audio
 */
import { CheckCircle2, DoorOpen, PanelLeftClose, PanelLeftOpen, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAnnounce } from '@/a11y/Announcer';
import { useSearchIndex } from '@/api/hooks';
import type { PlanRouteRequest, RouteOptionId, RoutePlan } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Page } from '@/components/shell/Page';
import type { XYPoint } from '@/features/map/FloorMap';
import { cn } from '@/lib/cn';
import { formatUnit } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { Lang } from '@/stores/preferences';
import { AudioNavigation } from './AudioNavigation';
import { placeOfCheckpoint } from './checkpoints';
import { useNav } from './navStore';
import { NavigationView } from './NavigationView';
import type { Place } from './PlaceSearch';
import { parseCheckpoint, usePosition } from './position';
import { usePositionActions } from './PositionPanel';
import { QrCheckpointDialog } from './QrCheckpointDialog';
import { formatDuration, needsFromProfile, RoutePlanner, type Needs } from './RoutePlanner';
import { RouteMap, type FloorRef } from './RouteMap';
import { buildTrack } from './routeModel';
import { useNavigationController } from './useNavigationController';

type Planned = { request: PlanRouteRequest; plan: RoutePlan; selected: RouteOptionId | null };

function ArrivalView({ onAgain, onDone, big }: { onAgain: () => void; onDone: () => void; big: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const label = useNav((s) => s.destinationLabel);
  const track = useNav((s) => s.track);
  const startedAt = useNav((s) => s.startedAt);
  const arrivedAt = useNav((s) => s.arrivedAt);
  const request = useNav((s) => s.request);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const roomCode = request?.to.type === 'room' ? request.to.id : null;
  const seconds = startedAt && arrivedAt ? (arrivedAt - startedAt) / 1000 : 0;
  return (
    <section data-theme={big ? 'hc' : undefined} aria-labelledby="arrived-title" className={cn('flex flex-col items-center gap-4 rounded-card border border-line bg-card p-8 text-center text-ink shadow-card', big && 'bg-canvas')}>
      <CheckCircle2 aria-hidden className="size-20 text-available" />
      <h2 id="arrived-title" ref={heading} tabIndex={-1} className={cn('font-bold', big ? 'text-4xl' : 'text-h1')}>
        {t('guide.arrived.title')}
      </h2>
      <p className={big ? 'text-3xl' : 'text-xl'}>{label}</p>
      {track ? <p className="text-base text-muted">{t('guide.arrived.summary', { distance: formatUnit(Math.round(track.total), 'meter', lang), time: formatDuration(seconds, lang) })}</p> : null}
      <div className="flex flex-wrap justify-center gap-2">
        {roomCode ? (
          <Link to={`/map?room=${encodeURIComponent(roomCode)}`} className="inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-5 text-base font-bold text-on-primary">
            <DoorOpen aria-hidden className="size-5" />
            {t('guide.arrived.details')}
          </Link>
        ) : null}
        <Button variant="secondary" icon={RotateCcw} onClick={onAgain}>
          {t('guide.arrived.again')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('guide.arrived.done')}
        </Button>
      </div>
    </section>
  );
}

export function NavigatePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const announce = useAnnounce();
  const [params, setParams] = useSearchParams();
  const index = useSearchIndex();
  const user = useAuth((s) => s.user);
  const profile = user?.accessibilityProfile;
  const phase = useNav((s) => s.phase);
  const audioMode = useNav((s) => s.audioMode);
  const message = useNav((s) => s.message);
  const position = usePosition((s) => s.position);
  const setPosition = usePosition((s) => s.set);
  const setPlace = usePositionActions();
  const controller = useNavigationController();

  const [from, setFrom] = useState<Place | null>(() => (usePosition.getState().position ? { kind: 'here', label: '' } : null));
  const [to, setTo] = useState<Place | null>(null);
  const [needs, setNeeds] = useState<Needs>(() => needsFromProfile(undefined));
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [picking, setPicking] = useState(false);
  const [qr, setQr] = useState(false);
  const [view, setView] = useState<FloorRef | null>(null);
  const [plannerCollapsed, setPlannerCollapsed] = useState(false);
  const audioDefault = params.get('mode') === 'audio' || !!profile?.audioGuidance;

  useEffect(() => setNeeds(needsFromProfile(profile)), [profile]);

  // Deep links: ?to= / ?from= (places), ?at= (QR checkpoint link: sets the position).
  const handled = useRef('');
  useEffect(() => {
    if (!index.data) return;
    const key = params.toString();
    if (handled.current === key) return;
    handled.current = key;
    const resolve = (raw: string | null) => {
      const cp = raw ? parseCheckpoint(raw) : null;
      return cp ? placeOfCheckpoint(cp, index.data!, lang) : null;
    };
    const toPlace = resolve(params.get('to'));
    if (toPlace) setTo(toPlace);
    const fromPlace = resolve(params.get('from'));
    if (fromPlace) setFrom(fromPlace);
    const at = resolve(params.get('at'));
    if (at) {
      void setPlace(at, 'qr');
      setFrom({ kind: 'here', label: '' });
    }
  }, [index.data, params, lang, setPlace]);

  // Keep the URL in sync with the destination (shareable "directions to A-104").
  useEffect(() => {
    if (!to || to.kind === 'here') return;
    const value = `${to.kind}:${to.id}`;
    if (params.get('to') !== value) {
      handled.current = '';
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('to', value);
          next.delete('at');
          handled.current = next.toString();
          return next;
        },
        { replace: true },
      );
    }
  }, [to, params, setParams]);

  // Visual mode: mirror guidance to the global live region (the audio screen has its own).
  useEffect(() => {
    if (message && !audioMode && phase !== 'plan') announce(message.text, message.politeness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);

  // Preview of the selected option on the planner map.
  const previewTrack = useMemo(() => {
    const option = planned?.plan.options.find((o) => o.id === planned.selected);
    return option && planned ? buildTrack(option, planned.plan.from) : null;
  }, [planned]);
  useEffect(() => setView(null), [previewTrack]);

  const start = async (audio: boolean) => {
    if (!planned?.selected) return;
    if (from && from.kind !== 'here') await setPlace(from, 'manual');
    const nav = useNav.getState();
    const toLabel = to && to.kind !== 'here' ? to.label : planned.plan.to.name;
    nav.setPlan(planned.request, planned.plan, toLabel);
    nav.choose(planned.selected);
    nav.start({ audio, voice: audio || !!profile?.audioGuidance });
    const first = useNav.getState().option?.steps.find((s) => s.type !== 'START');
    nav.say(`${t('guide.started', { place: toLabel })} ${first?.instruction ?? ''}`, 'assertive');
  };

  const stop = () => {
    useNav.getState().stop();
    announce(t('guide.stopped'));
  };
  const accept = () => {
    const nav = useNav.getState();
    if (nav.pending?.kind !== 'reroute') return;
    const route = nav.pending.route;
    nav.applyRoute(route, nav.pending.version);
    nav.setSim({ playing: true });
    const first = route.steps.find((s) => s.type !== 'START');
    nav.say(t('guide.reroute.accepted', { instruction: first?.instruction ?? '' }), 'assertive');
  };
  const retry = () => {
    useNav.getState().setPending(null);
    controller.recheck(true);
  };
  const change = () => {
    useNav.getState().stop();
  };

  const onPick = (p: XYPoint) => {
    const f = view ?? (previewTrack ? { floorId: previewTrack.points[0]!.floorId, level: previewTrack.points[0]!.level } : null);
    if (!f) return;
    setPosition({ x: p.x, y: p.y, level: f.level, floorId: f.floorId, accuracyM: 3, source: 'map', label: null });
    setFrom({ kind: 'here', label: '' });
    setPicking(false);
    announce(t('guide.pick.done'));
  };

  // Default floor for picking without a route: the position's, the start's, or Bloc A ground floor.
  const pickView: FloorRef | null = view ?? (position ? { floorId: position.floorId, level: position.level } : from && from.kind !== 'here' ? { floorId: from.floorId, level: from.level } : null);

  let body;
  if (phase === 'arrived') {
    body = (
      <ArrivalView
        big={audioMode}
        onAgain={() => {
          useNav.getState().reset();
          setFrom({ kind: 'here', label: '' });
          setTo(null);
        }}
        onDone={() => useNav.getState().reset()}
      />
    );
  } else if (phase === 'navigating') {
    body = audioMode ? (
      <AudioNavigation onStop={stop} onVisual={() => useNav.getState().setAudioMode(false)} onAccept={accept} onRetry={retry} onChange={change} repeat={controller.repeat} />
    ) : (
      <NavigationView onStop={stop} onAudio={() => useNav.getState().setAudioMode(true)} onAccept={accept} onRetry={retry} onChange={change} onWrongTurn={controller.wrongTurn} />
    );
  } else {
    const planner = (
      <RoutePlanner
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onPickOnMap={() => setPicking(true)}
        onQr={() => setQr(true)}
        onPlan={setPlanned}
        onStart={(audio) => void start(audio)}
        audioDefault={audioDefault}
        needs={needs}
        onNeeds={setNeeds}
      />
    );
    const map = (
      <div className="flex flex-col gap-2 h-full w-full">
        {picking ? (
          <p id="plan-pick-help" className="absolute top-3 end-16 z-[600] flex flex-wrap items-center gap-2 rounded-card bg-card p-3 text-sm font-bold text-ink shadow-float border border-line">
            {t('guide.pick.banner')}
            <Button variant="secondary" onClick={() => setPicking(false)}>
              {t('guide.pick.cancel')}
            </Button>
          </p>
        ) : (
          <p id="plan-map-help" className="sr-only">
            {t('guide.mapHelp')}
          </p>
        )}
        <RouteMap
          track={picking ? null : previewTrack}
          d={0}
          view={picking ? pickView : view}
          onView={setView}
          position={position}
          follow={false}
          onPick={picking ? onPick : null}
          onSelect={(item) => {
            if (!picking || item.kind !== 'room' || !index.data) return;
            const room = index.data.rooms.find((r) => r.id === item.id);
            if (!room) return;
            void setPlace({ kind: 'room', id: room.code, label: `${room.code} · ${lang === 'ar' && room.nameAr ? room.nameAr : room.name}`, level: room.level, floorId: room.floorId }, 'manual');
            setFrom({ kind: 'here', label: '' });
            setPicking(false);
          }}
          label={t('guide.mapLabel')}
          describedBy={picking ? 'plan-pick-help' : 'plan-map-help'}
          routeKey={`${planned?.plan.routeId}:${planned?.selected}`}
          animateRoute={!picking && Boolean(previewTrack)}
          className="h-full min-h-[560px] w-full rounded-card"
        />
      </div>
    );
    // Google Maps layout: Inputs and destinations floating INSIDE the map
    body = (
      <div className="relative isolate h-[calc(100dvh-130px)] min-h-[580px] w-full overflow-hidden rounded-card border border-line shadow-card">
        {/* Full-bleed interactive campus map */}
        <div className="absolute inset-0 size-full">
          {map}
        </div>

          {/* Compact, collapsible route panel. The map always remains usable behind it. */}
          <div className="absolute start-3 top-3 z-[450] flex max-h-[calc(100%-1.5rem)] w-[min(26rem,calc(100%-6rem))] flex-col pointer-events-auto">
            <button
              type="button"
              aria-expanded={!plannerCollapsed}
              aria-controls="route-planner-panel"
              onClick={() => setPlannerCollapsed((collapsed) => !collapsed)}
              className="ms-auto inline-flex min-h-12 items-center gap-1.5 rounded-control border border-line bg-card px-2.5 text-sm font-bold text-ink shadow-card hover:bg-surface-2"
            >
              {plannerCollapsed ? <PanelLeftOpen aria-hidden className="size-4" /> : <PanelLeftClose aria-hidden className="size-4" />}
              {plannerCollapsed ? 'Plan route' : 'Hide panel'}
            </button>
            {!plannerCollapsed ? <div id="route-planner-panel" className="mt-2 max-h-[calc(100dvh-11rem)] overflow-y-auto rounded-card">{planner}</div> : null}
          </div>
        </div>
        );
  }

        return (
        <Page title={t('page.navigate')} description={phase === 'plan' ? t('guide.description') : undefined} hideTitle={phase === 'navigating' && audioMode}>
          {body}
          <QrCheckpointDialog
            open={qr}
            onClose={() => setQr(false)}
            onPlace={(place) => {
              setQr(false);
              void setPlace(place, 'qr');
              setFrom({ kind: 'here', label: '' });
            }}
          />
        </Page>
        );
}
