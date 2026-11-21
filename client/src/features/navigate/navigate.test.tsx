/**
 * Step 7 integration tests: the Navigate page on real API payloads (src/test/fixtures),
 * an in-memory API adapter and a fake /live socket.
 */
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternalAxiosRequestConfig } from 'axios';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/api/client';
import type { Me, RoutePlan } from '@/api/types';
import { Providers, routes } from '@/App';
import i18n from '@/i18n';
import { LiveSocketContext } from '@/realtime/SocketProvider';
import { useAuth } from '@/stores/auth';
import { useMapPrefs } from '@/stores/mapPrefs';
import { usePreferences } from '@/stores/preferences';
import { axeViolations } from '@/test/axe';
import buildings from '@/test/fixtures/buildings.json';
import floorA1 from '@/test/fixtures/floorA1.json';
import planJson from '@/test/fixtures/planA104.json';
import planFastestJson from '@/test/fixtures/planA104Fastest.json';
import planNoRoute from '@/test/fixtures/planNoRoute.json';
import recheckRerouted from '@/test/fixtures/recheckRerouted.json';
import roomA104 from '@/test/fixtures/roomA104.json';
import searchIndex from '@/test/fixtures/searchIndex.json';
import { useNav } from './navStore';
import { usePosition } from './position';
import { buildTrack, positionAt } from './routeModel';

const plan = planJson as unknown as RoutePlan;
const ENTRANCE = searchIndex.pois.find((p) => p.name === 'Entrée principale Bloc A')!.id;
type Call = { method: string; url: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
let recheckReply: unknown;
let sharing: { consent: boolean; session: 'NONE' | 'ACTIVE' };

const onRoute = (version = 1) => ({ routeId: plan.routeId, version, option: 'step-free', status: 'ON_ROUTE', reason: null, message: 'On route', distanceFromRouteM: 0, progress: null, blockedEdge: null, route: null, unavailable: null });
const status = (state: 'NONE' | 'ACTIVE') => ({
  state,
  message: null,
  session: state === 'ACTIVE' ? { id: 's9', needsCategory: 'WHEELCHAIR', startedAt: '2026-11-20T08:00:00.000Z', endedAt: null, endReason: null, pointCount: 0, lastPointAt: null, autoStopAt: '2026-11-20T11:00:00.000Z', autoStopReason: 'TIME_LIMIT', remainingSec: 9000, reminder: null } : null,
});

function respond(method: string, url: string, body: Record<string, unknown> | null): unknown {
  if (url === '/api/campus/buildings') return buildings;
  if (url === '/api/campus/search-index') return searchIndex;
  if (url.startsWith('/api/campus/floors/')) return floorA1;
  if (url.startsWith('/api/rooms/')) return roomA104;
  if (url === '/api/speech/status') return { tts: { available: false, provider: 'cartesia', model: 'sonic-3.6', languages: [], maxChars: 600 } };
  if (url === '/api/routes/plan') {
    const c = (body?.constraints ?? {}) as Record<string, unknown>;
    if (c.minDoorWidthCm === 120) return planNoRoute;
    return body?.options ? planFastestJson : planJson;
  }
  if (url.endsWith('/recheck')) return recheckReply;
  if (url === '/api/mobility/consent' && method === 'get') return { granted: sharing.consent, upToDate: sharing.consent, policyVersion: '2026-11-v1', grantedAt: null, revokedAt: null, currentPolicy: { version: '2026-11-v1', summary: ['Opt-in, stops by itself.'], retentionDays: 30 } };
  if (url === '/api/mobility/consent') return { granted: true, upToDate: true, policyVersion: '2026-11-v1', grantedAt: null, revokedAt: null, currentPolicy: { version: '2026-11-v1', summary: [], retentionDays: 30 } };
  if (url === '/api/mobility/sessions/current') return status(sharing.session);
  if (url === '/api/mobility/sessions') return status('ACTIVE');
  if (url.endsWith('/stop')) return status('NONE');
  if (url === '/api/mobility/events') return { id: 'e1', type: body?.type, edgeId: null, recordedAt: '2026-11-20T09:00:00.000Z' };
  if (url === '/api/mobility/points') return { accepted: 1, dropped: { lowAccuracy: 0, outsideGeofence: 0, jitter: 0, outOfSession: 0 }, session: status('ACTIVE') };
  return undefined;
}

/** Fake /live socket: records emits, lets tests push server events. */
function fakeSocket() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const emitted: [string, unknown][] = [];
  return {
    emitted,
    on: (e: string, h: (p: unknown) => void) => void (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h),
    off: (e: string, h: (p: unknown) => void) => void handlers.get(e)?.delete(h),
    emit: (e: string, p: unknown) => void emitted.push([e, p]),
    push: (e: string, p: unknown) => handlers.get(e)?.forEach((h) => h(p)),
  };
}

const me = (profile: Partial<Me['accessibilityProfile']> = {}): Me => ({
  id: 'u1',
  email: 'yacine@campusway.local',
  displayName: 'Yacine B.',
  role: 'STUDENT',
  locale: 'en',
  createdAt: '2026-11-01T00:00:00.000Z',
  accessibilityProfile: {
    mobility: 'WHEELCHAIR',
    stepFree: true,
    requireVerifiedRamps: false,
    maxSlopePercent: null,
    minPassageWidthCm: 120,
    avoidClosedPassages: true,
    audioGuidance: false,
    shorelineHints: false,
    captions: false,
    textToSpeech: false,
    highContrast: false,
    reducedMotion: true,
    textScale: 1,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...profile,
  },
});

beforeAll(() => {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const body = typeof config.data === 'string' ? (JSON.parse(config.data) as Record<string, unknown>) : null;
    calls.push({ method: config.method!, url: config.url!, body });
    const data = respond(config.method!, config.url!, body);
    if (data === undefined) throw Object.assign(new Error('offline'), { isAxiosError: true, config, response: undefined });
    return { data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config };
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

beforeEach(async () => {
  calls.length = 0;
  recheckReply = onRoute();
  sharing = { consent: true, session: 'NONE' };
  window.innerWidth = 1440;
  usePreferences.setState({ theme: 'light', motion: 'reduce', textScale: 1, lang: 'en', sidebarCollapsed: false, floorId: null });
  useMapPrefs.getState().setAll(true);
  useAuth.getState().clear();
  useNav.getState().reset();
  useNav.setState({ voice: false, audioMode: false, sim: { active: false, playing: true, speed: 1 } });
  usePosition.getState().clear();
  await i18n.changeLanguage('en');
});

function renderAt(path: string) {
  const socket = fakeSocket();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <div id="root">
      <Providers queryClient={queryClient}>
        <LiveSocketContext.Provider value={{ socket: socket as never, connected: true }}>
          <RouterProvider router={router} />
        </LiveSocketContext.Provider>
      </Providers>
    </div>,
  );
  return { ...view, router, socket };
}

/** Every guidance message, in order. */
function spoken(): string[] {
  const out: string[] = [];
  useNav.subscribe((s, prev) => {
    if (s.message && s.message !== prev.message) out.push(s.message.text);
  });
  return out;
}

const plannedPath = `/navigate?to=room:A-104&at=poi:${ENTRANCE}`;
const walkTo = (option: 'fastest' | 'step-free', d: number) => {
  const o = plan.options.find((x) => x.id === option)!;
  const p = positionAt(buildTrack(o, plan.from), d);
  act(() => usePosition.getState().set({ x: p.x, y: p.y, level: p.level, floorId: p.floorId, accuracyM: 1, source: 'qr', label: null }));
};

describe('Route planner', () => {
  it('plans from a QR checkpoint link: Fastest vs Step-free with time, distance and counts', async () => {
    const { container } = renderAt(plannedPath);
    const fastest = await screen.findByRole('radio', { name: /Fastest/ });
    expect(fastest).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('My location · Entrée principale Bloc A · QR checkpoint · ±1 m');
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('A-104 · Salle de TD A-104');
    const cards = screen.getByRole('group', { name: 'Route options' });
    expect(within(cards).getByText('0 elevators · 1 staircase · 0 ramps')).toBeInTheDocument();
    expect(within(cards).getByText('1 elevator · 0 staircases · 0 ramps')).toBeInTheDocument();
    expect(within(cards).getByText('The route has steps')).toBeInTheDocument();
    const req = calls.find((c) => c.url === '/api/routes/plan')!.body!;
    expect(req.from).toEqual({ type: 'point', x: 56, y: 85, level: 0, floorId: plan.from.floorId });
    expect(req.to).toEqual({ type: 'room', id: 'A-104' });
    expect(req.constraints).toEqual({ avoidStairs: false, verifiedRampsOnly: false, maxSlopePercent: null, minDoorWidthCm: null, verifiedOnly: false });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('pre-fills the needs from the profile; no route → why, and "Allow" relaxes that need', async () => {
    const user = userEvent.setup();
    useAuth.getState().setSession('t', me());
    renderAt(plannedPath);
    expect(await screen.findByRole('button', { name: 'Step-free' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Passages ≥ 120/ })).toHaveAttribute('aria-pressed', 'true');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No route matches these needs');
    expect(alert).toHaveTextContent('Step-free: Too narrow: 90 cm for a 120 cm minimum (Ascenseur Bloc A).');
    expect(within(alert).getAllByText('Ascenseur Bloc A (90 / 120)')).toHaveLength(1);
    expect(within(alert).getByText('Porte A-104 (90 / 120)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start navigation' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow narrower passages' }));
    expect(await screen.findByRole('radio', { name: /Step-free/ })).toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/api/routes/plan').at(-1)!.body!.constraints).toMatchObject({ avoidStairs: true, minDoorWidthCm: null });
  });
});

describe('Visual guidance', () => {
  it('guides step by step: cues before decision points, automatic floor switch, recheck, arrival', async () => {
    const user = userEvent.setup();
    const said = spoken();
    const { container } = renderAt(plannedPath);
    await user.click(await screen.findByRole('radio', { name: /Step-free/ }));
    await user.click(screen.getByRole('button', { name: 'Start navigation' }));

    const bar = await screen.findByRole('region', { name: 'Current instruction' });
    expect(bar).toHaveTextContent('Go straight for 21 m to ascenseur');
    expect(bar).toHaveTextContent('Then: Take the elevator to the floor 1');
    expect(said[0]).toBe('Guidance to A-104 · Salle de TD A-104 started. Go straight for 21 m to ascenseur, boutons en braille, annonce vocale');
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '0');
    expect(document.activeElement).toBe(bar);

    walkTo('step-free', 10);
    expect(said.at(-1)).toBe('In 11 m: Take the elevator to the floor 1');
    walkTo('step-free', 19.5);
    expect(said.at(-1)).toBe('Take the elevator to the floor 1');
    expect(within(container.querySelector('ol')!).getByText(/Go straight for 21 m/).closest('li')).toHaveAttribute('aria-current', 'step');

    walkTo('step-free', 30);
    expect(said).toContain('You are now on Floor 1.');
    expect(within(container.querySelector('ol')!).getByText('Go straight for 6 m').closest('li')).toHaveAttribute('aria-current', 'step');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bloc A · Floor 1' })).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(calls.some((c) => c.url === `/api/routes/${plan.routeId}/recheck`)).toBe(true));
    const recheck = calls.find((c) => c.url.endsWith('/recheck'))!.body!;
    expect(recheck).toMatchObject({ option: 'step-free', lang: 'en', position: { accuracyM: 1 } });
    expect(await axeViolations(container)).toEqual([]);

    walkTo('step-free', 68.9);
    expect(await screen.findByRole('heading', { name: 'You have arrived' })).toHaveFocus();
    expect(said.at(-1)).toBe('You have arrived: A-104 · Salle de TD A-104.');
    expect(screen.getByRole('link', { name: 'Room details' })).toHaveAttribute('href', '/map?room=A-104');
  });

  it('live rerouting: route:invalidated → recheck → spoken alert → accept the new route', async () => {
    const user = userEvent.setup();
    const said = spoken();
    const { socket } = renderAt(plannedPath);
    await user.click(await screen.findByRole('button', { name: 'Start navigation' }));
    await waitFor(() => expect(socket.emitted).toContainEqual(['route:watch', { routeId: plan.routeId }]));
    expect(screen.getByText('Take the stairs up to the floor 1 (24 steps)')).toBeInTheDocument();

    recheckReply = recheckRerouted;
    act(() => socket.push('route:invalidated', { routeId: plan.routeId, option: 'fastest', reason: 'EDGE_CLOSED', edgeId: 'E-A0-STAIRS--A1-STAIRS', version: 1, rerouted: false, at: '' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Route changed');
    expect(alert).toHaveTextContent('Escalier Bloc A is closed — rerouting via the elevator.');
    expect(said.at(-1)).toBe('Escalier Bloc A is closed — rerouting via the elevator. Accept to follow the new route.');
    expect(useNav.getState().message?.politeness).toBe('assertive');

    await user.click(screen.getByRole('button', { name: 'Follow the new route' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Take the elevator to the floor 1')).toBeInTheDocument();
    expect(screen.queryByText('Take the stairs up to the floor 1 (24 steps)')).not.toBeInTheDocument();
    expect(useNav.getState().version).toBe(2);
    expect(said.at(-1)).toMatch(/^New route\. Go straight for 21 m/);
  });
});

describe('Audio guidance', () => {
  it('minimal high-contrast screen; W = where am I, Space = repeat, P = pause; mirrored in a live region', async () => {
    const user = userEvent.setup();
    const { container } = renderAt(`${plannedPath}&mode=audio`);
    await user.click(await screen.findByRole('button', { name: 'Start audio guidance' }));
    const screenEl = await screen.findByRole('region', { name: /Audio guidance/ });
    expect(screenEl).toHaveAttribute('data-theme', 'hc');
    expect(useNav.getState()).toMatchObject({ audioMode: true, voice: true });
    const assertive = screenEl.querySelector('[aria-live="assertive"]')!;

    fireEvent.keyDown(document.body, { key: 'w' });
    expect(assertive).toHaveTextContent('You are on Bloc A · Ground floor.');
    expect(assertive).toHaveTextContent('At Entrée principale Bloc A.');
    expect(assertive).toHaveTextContent('Now: Go straight for 15 m Next, in 15 m: Turn right, then go straight for 8 m');
    expect(assertive).toHaveTextContent('Position from QR checkpoint, accurate to about 1 m.');

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(assertive).toHaveTextContent(/^Go straight for 15 m 15 m to go on this step\.$/);

    fireEvent.keyDown(document.body, { key: 'p' });
    expect(assertive).toHaveTextContent('Guidance paused.');
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Report a problem here', () => {
  it('sharing off: opens a one-off anonymous session, sends the report tagged with the route, closes it', async () => {
    const user = userEvent.setup();
    useAuth.getState().setSession('t', me({ minPassageWidthCm: null, stepFree: false }));
    renderAt(plannedPath);
    await user.click(await screen.findByRole('button', { name: 'Start navigation' }));
    await user.click(screen.getByRole('button', { name: 'Report a problem here' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report a problem here' });
    await user.click(within(dialog).getByText('Too steep'));
    await user.type(within(dialog).getByLabelText('Details (optional)'), 'Ramp too steep');
    await user.click(within(dialog).getByRole('button', { name: 'Share for this report and send' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/mobility/sessions/s9/stop')).toBe(true));
    const sequence = calls.filter((c) => c.method === 'post' && c.url.startsWith('/api/mobility')).map((c) => c.url);
    expect(sequence).toEqual(['/api/mobility/sessions', '/api/mobility/events', '/api/mobility/sessions/s9/stop']);
    expect(calls.find((c) => c.url === '/api/mobility/events')!.body).toEqual({ sessionId: 's9', type: 'TOO_STEEP', x: 56, y: 85, level: 0, floorId: plan.from.floorId, note: 'Ramp too steep', routeId: plan.routeId });
    expect(await screen.findByText('Thank you, your report was sent.')).toBeInTheDocument();
  });

  it('signed out: asks to sign in', async () => {
    const user = userEvent.setup();
    renderAt(plannedPath);
    await user.click(await screen.findByRole('button', { name: 'Start navigation' }));
    await user.click(screen.getByRole('button', { name: 'Report a problem here' }));
    expect(within(await screen.findByRole('dialog')).getByRole('link', { name: 'Sign in to report a problem.' })).toHaveAttribute('href', '/login');
  });
});
