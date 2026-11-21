/**
 * Runs a navigation session: position → progress → spoken / visual cues;
 * /routes/:id/recheck on movement; "route:invalidated" → recheck → reroute alert;
 * arrival; demo simulator; voice; logging to the mobility session when sharing is on.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorCode } from '@/api/client';
import type { RecheckRouteRequest, RouteOption, RoutePlan, RouteRecheck, SpeechStatus } from '@/api/types';
import { useTrackLogger } from '@/features/sharing/sharing';
import { floorLabel } from '@/lib/floors';
import { formatUnit } from '@/lib/format';
import { useLiveSocket, useSocketEvent } from '@/realtime/SocketProvider';
import { useAuth } from '@/stores/auth';
import type { Lang } from '@/stores/preferences';
import { useNav } from './navStore';
import { Simulator, usePosition, type Position } from './position';
import { AT_DECISION_M, dueCues, locate, metresToNextStep, stepIndexAt, vibrationFor, viaOf } from './routeModel';
import { Speaker, vibrate } from './speech';

export const OFF_ROUTE_M = 8;
const ARRIVE_M = 3;
const RECHECK_MIN_MS = 2000;
const RECHECK_MOVE_M = 3;
const RECHECK_IDLE_MS = 8000;
const SIM_TICK_MS = 500;

type RouteInvalidated = { routeId: string; option: string; reason: string; edgeId: string | null; version: number; rerouted: boolean };

export function useSpeechStatus() {
  return useQuery({ queryKey: ['speech', 'status'], queryFn: async () => (await api.get<SpeechStatus>('/api/speech/status')).data, staleTime: 10 * 60_000, retry: false });
}

/** Sentence for a reroute caused by a closed passage: "<X> is out of service — rerouting via <Y>." */
export function rerouteMessage(t: (k: string, o?: Record<string, unknown>) => string, oldRoute: RouteOption | null, res: RouteRecheck): string {
  const blocked = res.blockedEdge;
  if (!blocked || !res.route) return res.message;
  const blockedStep = oldRoute?.steps.find((s) => s.edgeIds.includes(blocked.edgeId));
  const what = blockedStep?.type === 'ELEVATOR' ? t('guide.reroute.elevatorOut', { what: blocked.description }) : t('guide.reroute.closed', { what: blocked.description });
  const via = viaOf(res.route, oldRoute?.edgeIds ?? []);
  // Ramps and elevators by kind (localised); other steps by their landmark.
  const viaName = via ? (via.type === 'RAMP' || via.type === 'ELEVATOR' || !via.landmark ? t(`guide.stepType.${via.type}`) : via.landmark) : null;
  const tail = viaName ? t('guide.reroute.via', { via: viaName }) : t('guide.reroute.newRoute');
  return `${what} — ${tail}`;
}

export function useNavigationController() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const phase = useNav((s) => s.phase);
  const track = useNav((s) => s.track);
  const routeId = useNav((s) => s.routeId);
  const optionId = useNav((s) => s.optionId);
  const paused = useNav((s) => s.paused);
  const voice = useNav((s) => s.voice);
  const message = useNav((s) => s.message);
  const sim = useNav((s) => s.sim);
  const pending = useNav((s) => s.pending);
  const position = usePosition((s) => s.position);
  const setPosition = usePosition((s) => s.set);
  const signedIn = useAuth((s) => s.status === 'authenticated');
  const speech = useSpeechStatus();
  const navigating = phase === 'navigating';

  // ───── voice ─────
  const serverVoice = useRef<(l: Lang) => boolean>(() => false);
  serverVoice.current = (l) => signedIn && !!speech.data?.tts.available && speech.data.tts.languages.includes(l);
  const speaker = useMemo(() => new Speaker({ serverVoice: (l) => serverVoice.current(l) }), []);
  useEffect(() => () => speaker.dispose(), [speaker]);
  useEffect(() => {
    if (!message || !voice || phase === 'plan') return;
    if (paused && message.politeness !== 'assertive') return;
    speaker.speak(message.text, lang, { interrupt: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);
  useEffect(() => {
    if (!voice || paused) speaker.stop();
  }, [voice, paused, speaker]);

  // ───── cues and progress from the position ─────
  const said = useRef(new Set<string>());
  const lastLevel = useRef<number | null>(null);
  const hintD = useRef<number | null>(null);
  // New route: its first step was just said (start / accepted message), so do not cue it again.
  useEffect(() => {
    said.current = new Set();
    hintD.current = null;
    const first = track?.steps.find((s) => s.type !== 'START');
    const version = useNav.getState().version;
    if (first) for (const k of ['pre', 'at']) said.current.add(`${version}:${first.index}:${k}`);
  }, [track]);

  const recheckRef = useRef<(force?: boolean) => void>(() => undefined);

  useEffect(() => {
    if (!navigating || !track || !position) return;
    const nav = useNav.getState();
    const loc = locate(track, position, hintD.current);
    const d = loc?.d ?? nav.d;
    if (loc) hintD.current = loc.d;
    const stepIndex = stepIndexAt(track, d);
    nav.setProgress({ d, offRouteM: loc?.offRouteM ?? null, stepIndex });

    if (lastLevel.current !== null && lastLevel.current !== position.level) {
      nav.say(t('guide.floorNow', { floor: floorLabel(position.level, t) }));
    }
    lastLevel.current = position.level;

    const onRoute = loc !== null && loc.offRouteM <= OFF_ROUTE_M;
    if (onRoute && d >= track.total - ARRIVE_M) {
      nav.arrive();
      return;
    }
    if (!onRoute) {
      recheckRef.current(true);
      return;
    }
    if (!nav.paused && !nav.pending) {
      for (const cue of dueCues(track, d, said.current, nav.version)) {
        said.current.add(cue.key);
        if (cue.step.type === 'ARRIVE') continue;
        const text = cue.kind === 'pre' ? t('guide.cue.pre', { distance: formatUnit(Math.round(cue.metres), 'meter', lang), instruction: cue.step.instruction }) : cue.step.instruction;
        nav.say(text);
        if (cue.kind === 'at' && cue.metres <= AT_DECISION_M) vibrate(vibrationFor(cue.step));
      }
    }
    recheckRef.current(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, track, navigating]);

  // ───── arrival ─────
  const arrivedAnnounced = useRef(false);
  useEffect(() => {
    if (phase !== 'arrived') {
      arrivedAnnounced.current = false;
      return;
    }
    if (arrivedAnnounced.current) return;
    arrivedAnnounced.current = true;
    const nav = useNav.getState();
    nav.say(t('guide.arrivedAt', { place: nav.destinationLabel }), 'assertive');
    vibrate([120, 80, 120, 80, 120]);
  }, [phase, t]);

  // ───── recheck ─────
  const inFlight = useRef(false);
  const queued = useRef(false);
  const last = useRef({ at: 0, x: 0, y: 0, level: 0 });

  const handle = useCallback(
    (res: RouteRecheck) => {
      const nav = useNav.getState();
      if (res.version < nav.version) return;
      if (res.status === 'ARRIVED') {
        nav.arrive();
      } else if (res.status === 'REROUTED' && res.route) {
        if (res.reason === 'EDGE_CLOSED') {
          const text = rerouteMessage(t, nav.option, res);
          nav.setPending({ kind: 'reroute', route: res.route, version: res.version, message: text });
          nav.say(`${text} ${t('guide.reroute.acceptHint')}`, 'assertive');
          vibrate([400, 120, 400]);
        } else {
          nav.applyRoute(res.route, res.version);
          nav.say(res.message, 'assertive');
        }
      } else if (res.status === 'NO_ROUTE') {
        const text = res.unavailable?.message ?? res.message;
        nav.setPending({ kind: 'noRoute', message: text });
        nav.say(text, 'assertive');
      }
    },
    [t],
  );

  const replan = useCallback(
    async (pos: Position) => {
      const nav = useNav.getState();
      if (!nav.request) return;
      const body = { ...nav.request, from: { type: 'point' as const, x: pos.x, y: pos.y, level: pos.level, ...(pos.floorId ? { floorId: pos.floorId } : {}) }, lang };
      const plan = (await api.post<RoutePlan>('/api/routes/plan', body)).data;
      if (plan.options.length === 0) {
        const text = plan.unavailable[0]?.message ?? t('guide.noRoute.title');
        nav.setPending({ kind: 'noRoute', message: text });
        nav.say(text, 'assertive');
        return;
      }
      nav.replacePlan(plan);
      nav.say(t('guide.routeRefreshed'), 'polite');
    },
    [lang, t],
  );

  const recheck = useCallback(
    (force = false) => {
      const nav = useNav.getState();
      const pos = usePosition.getState().position;
      if (nav.phase !== 'navigating' || !nav.routeId || !pos || nav.pending) return;
      if (inFlight.current) {
        if (force) queued.current = true;
        return;
      }
      const now = Date.now();
      const moved = Math.hypot(pos.x - last.current.x, pos.y - last.current.y);
      if (!force) {
        if (now - last.current.at < RECHECK_MIN_MS) return;
        if (moved < RECHECK_MOVE_M && pos.level === last.current.level && now - last.current.at < RECHECK_IDLE_MS) return;
      } else if (now - last.current.at < 600 && moved < 1) return;
      last.current = { at: now, x: pos.x, y: pos.y, level: pos.level };
      inFlight.current = true;
      const body: RecheckRouteRequest = {
        position: { x: pos.x, y: pos.y, level: pos.level, ...(pos.floorId ? { floorId: pos.floorId } : {}), accuracyM: pos.accuracyM },
        ...(nav.optionId ? { option: nav.optionId } : {}),
        lang,
      };
      api
        .post<RouteRecheck>(`/api/routes/${nav.routeId}/recheck`, body)
        .then((r) => handle(r.data))
        .catch(async (err: unknown) => {
          const code = errorCode(err);
          if (code === 'ROUTE_NOT_FOUND') await replan(pos).catch(() => undefined);
          else if (code === 'LOCATION_OFF_GRAPH') useNav.getState().say(t('guide.offGraph'), 'polite');
        })
        .finally(() => {
          inFlight.current = false;
          if (queued.current) {
            queued.current = false;
            recheck(true);
          }
        });
    },
    [handle, replan, lang, t],
  );
  recheckRef.current = recheck;

  // ───── live invalidation ─────
  const { socket, connected } = useLiveSocket();
  useEffect(() => {
    if (!socket || !connected || !routeId || phase === 'plan') return undefined;
    socket.emit('route:watch', { routeId });
    return () => {
      socket.emit('route:unwatch', { routeId });
    };
  }, [socket, connected, routeId, phase]);
  useSocketEvent<RouteInvalidated>('route:invalidated', (e) => {
    const nav = useNav.getState();
    if (e.routeId !== nav.routeId || nav.phase !== 'navigating') return;
    if (e.rerouted && e.version <= nav.version) return; // our own recheck already answered
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    last.current.at = 0;
    recheck(true);
  });

  // ───── demo simulator ─────
  const simulator = useRef<Simulator | null>(null);
  useEffect(() => {
    if (!sim.active || !track) {
      simulator.current = null;
      return;
    }
    const speed = useNav.getState().plan?.travelMode === 'wheelchair' ? 1 : 1.2;
    const pos = usePosition.getState().position;
    const start = pos ? (locate(track, pos)?.d ?? 0) : 0;
    if (!simulator.current) simulator.current = new Simulator(track, speed);
    simulator.current.setTrack(track, start);
    setPosition(simulator.current.position());
  }, [sim.active, track, setPosition]);

  useEffect(() => {
    if (!navigating || !sim.active || !sim.playing || paused || pending) return undefined;
    const id = window.setInterval(() => {
      const s = simulator.current;
      if (!s || s.done) return;
      setPosition(s.tick(SIM_TICK_MS / 1000, sim.speed));
    }, SIM_TICK_MS);
    return () => window.clearInterval(id);
  }, [navigating, sim.active, sim.playing, sim.speed, paused, pending, setPosition]);

  const wrongTurn = useCallback(() => {
    const s = simulator.current;
    if (!s) return;
    useNav.getState().setSim({ playing: false });
    setPosition(s.wrongTurn());
  }, [setPosition]);

  // ───── logging (sharing on) ─────
  useTrackLogger(navigating ? position : null, navigating ? routeId : null, () => useNav.getState().say(t('sharing.endedDuringNav'), 'polite'));

  // ───── user commands ─────
  const repeat = useCallback(() => {
    const nav = useNav.getState();
    const step = nav.option?.steps.find((s) => s.index === nav.stepIndex);
    if (!step || !nav.track) return;
    const left = metresToNextStep(nav.track, step.index, nav.d);
    nav.say(`${step.instruction} ${t('guide.metresLeft', { distance: formatUnit(Math.round(left), 'meter', lang) })}`, 'assertive');
  }, [t, lang]);

  return { repeat, wrongTurn, recheck, optionId };
}
