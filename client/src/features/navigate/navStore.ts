/**
 * Navigation session state, shared by the visual and the audio screens.
 * Effects (recheck, socket, speech, simulator, logging) live in useNavigationController.
 */
import { create } from 'zustand';
import type { PlanRouteRequest, RouteOption, RouteOptionId, RoutePlan } from '@/api/types';
import { buildTrack, type Track } from './routeModel';
import type { SimSpeed } from './position';

export type Phase = 'plan' | 'navigating' | 'arrived';

export type Pending =
  | { kind: 'reroute'; route: RouteOption; version: number; message: string }
  | { kind: 'noRoute'; message: string };

export type GuideMessage = { id: number; text: string; politeness: 'polite' | 'assertive' };

type NavState = {
  phase: Phase;
  request: PlanRouteRequest | null;
  plan: RoutePlan | null;
  optionId: RouteOptionId | null;
  option: RouteOption | null;
  track: Track | null;
  routeId: string | null;
  version: number;
  destinationLabel: string;
  /** Progress along the track, metres. */
  d: number;
  offRouteM: number | null;
  stepIndex: number;
  pending: Pending | null;
  startedAt: number | null;
  arrivedAt: number | null;
  /** Guidance paused: no cues, no simulation. */
  paused: boolean;
  /** App voice on (screen-reader users may prefer it off: the live region still speaks). */
  voice: boolean;
  audioMode: boolean;
  sim: { active: boolean; playing: boolean; speed: SimSpeed };
  message: GuideMessage | null;

  setPlan: (request: PlanRouteRequest, plan: RoutePlan, destinationLabel: string) => void;
  choose: (optionId: RouteOptionId) => void;
  start: (opts: { audio: boolean; voice: boolean }) => void;
  setProgress: (p: { d: number; offRouteM: number | null; stepIndex: number }) => void;
  applyRoute: (route: RouteOption, version: number) => void;
  replacePlan: (plan: RoutePlan) => void;
  setPending: (p: Pending | null) => void;
  arrive: () => void;
  stop: () => void;
  reset: () => void;
  setPaused: (paused: boolean) => void;
  setVoice: (voice: boolean) => void;
  setAudioMode: (audio: boolean) => void;
  setSim: (patch: Partial<NavState['sim']>) => void;
  say: (text: string, politeness?: 'polite' | 'assertive') => void;
};

const fromOf = (route: RouteOption) => {
  const s = route.steps[0]!;
  return { x: s.x, y: s.y, level: s.level, floorId: s.floorId };
};

const initial = {
  phase: 'plan' as Phase,
  request: null,
  plan: null,
  optionId: null,
  option: null,
  track: null,
  routeId: null,
  version: 1,
  destinationLabel: '',
  d: 0,
  offRouteM: null,
  stepIndex: 0,
  pending: null,
  startedAt: null,
  arrivedAt: null,
  paused: false,
  message: null,
};

let messageId = 0;

export const useNav = create<NavState>()((set, get) => ({
  ...initial,
  voice: false,
  audioMode: false,
  sim: { active: false, playing: true, speed: 1 },

  setPlan: (request, plan, destinationLabel) => {
    const option = plan.options[0] ?? null;
    set({
      ...initial,
      request,
      plan,
      destinationLabel,
      routeId: plan.routeId,
      version: plan.version,
      optionId: option?.id ?? null,
      option,
      track: option ? buildTrack(option, plan.from) : null,
    });
  },
  choose: (optionId) => {
    const plan = get().plan;
    const option = plan?.options.find((o) => o.id === optionId);
    if (plan && option) set({ optionId, option, track: buildTrack(option, plan.from) });
  },
  start: ({ audio, voice }) => set({ phase: 'navigating', startedAt: Date.now(), arrivedAt: null, d: 0, offRouteM: null, pending: null, paused: false, audioMode: audio, voice, stepIndex: get().option?.steps.find((s) => s.type !== 'START')?.index ?? 0 }),
  setProgress: ({ d, offRouteM, stepIndex }) => set({ d, offRouteM, stepIndex }),
  applyRoute: (route, version) => set({ option: route, optionId: route.id, track: buildTrack(route, fromOf(route)), version, d: 0, offRouteM: null, pending: null, stepIndex: route.steps.find((s) => s.type !== 'START')?.index ?? 0 }),
  replacePlan: (plan) => {
    const option = plan.options.find((o) => o.id === get().optionId) ?? plan.options[0] ?? null;
    if (!option) return;
    set({ plan, routeId: plan.routeId, version: plan.version, option, optionId: option.id, track: buildTrack(option, plan.from), d: 0, offRouteM: null, pending: null });
  },
  setPending: (pending) => set({ pending }),
  arrive: () => set({ phase: 'arrived', arrivedAt: Date.now(), pending: null, sim: { ...get().sim, playing: false } }),
  stop: () => set({ phase: 'plan', pending: null, paused: false, startedAt: null, arrivedAt: null, d: 0, sim: { ...get().sim, active: false } }),
  reset: () => set({ ...initial, sim: { ...get().sim, active: false } }),
  setPaused: (paused) => set({ paused }),
  setVoice: (voice) => set({ voice }),
  setAudioMode: (audioMode) => set({ audioMode }),
  setSim: (patch) => set({ sim: { ...get().sim, ...patch } }),
  say: (text, politeness = 'polite') => set({ message: { id: ++messageId, text, politeness } }),
}));
