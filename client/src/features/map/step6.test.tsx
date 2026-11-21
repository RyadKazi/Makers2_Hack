/**
 * Step 6 integration tests on real API payloads captured from the seeded server
 * (src/test/fixtures). The API is replaced by an in-memory adapter.
 */
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternalAxiosRequestConfig } from 'axios';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { api } from '@/api/client';
import { queryKeys } from '@/api/hooks';
import type { FloorPlan, RoomList } from '@/api/types';
import { Providers, routes } from '@/App';
import i18n from '@/i18n';
import { applyRoomStatus } from '@/realtime/liveRooms';
import { useMapPrefs } from '@/stores/mapPrefs';
import { usePreferences } from '@/stores/preferences';
import { axeViolations } from '@/test/axe';
import buildings from '@/test/fixtures/buildings.json';
import floorA1 from '@/test/fixtures/floorA1.json';
import overview from '@/test/fixtures/overview.json';
import roomA104 from '@/test/fixtures/roomA104.json';
import rooms from '@/test/fixtures/rooms.json';
import searchIndex from '@/test/fixtures/searchIndex.json';
import { FloorMap } from './FloorMap';

const plan = floorA1 as unknown as FloorPlan;
const calls: { url: string; params: Record<string, unknown> }[] = [];

function respond(url: string): unknown {
  if (url === '/api/campus/buildings') return buildings;
  if (url === '/api/campus/search-index') return searchIndex;
  if (url.startsWith('/api/campus/floors/')) return floorA1;
  if (url === '/api/campus') return overview;
  if (url === '/api/rooms') return rooms;
  if (url.startsWith('/api/rooms/')) return roomA104;
  return undefined;
}

beforeAll(() => {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push({ url: config.url!, params: (config.params ?? {}) as Record<string, unknown> });
    const data = respond(config.url!);
    if (data === undefined) throw Object.assign(new Error('offline'), { isAxiosError: true, config, response: undefined });
    return { data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config };
  };
  // Leaflet sizes the map from the container; jsdom has no layout.
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
  window.innerWidth = 1440;
  usePreferences.setState({ theme: 'light', motion: 'reduce', textScale: 1, lang: 'en', sidebarCollapsed: false, floorId: null });
  useMapPrefs.getState().setAll(true);
  await i18n.changeLanguage('en');
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <div id="root">
      <Providers queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>
    </div>,
  );
  return { ...view, router, queryClient };
}

describe('FloorMap (Leaflet, CRS.Simple)', () => {
  function Harness({ p, onSelect = () => undefined }: { p: FloorPlan; onSelect?: (x: unknown) => void }) {
    return (
      <div style={{ width: 900, height: 600 }}>
        <FloorMap scope="floor" plan={p} overview={undefined} layers={useMapPrefs.getState().layers} selected={null} onSelect={onSelect} label="Plan" describedBy="help" />
      </div>
    );
  }

  it('renders every room and place as a named button, with status in the name, in reading order', () => {
    // Captured fixture statuses are "today"; keep the clock on that campus day so
    // formatTime renders a plain HH:mm instead of a weekday-prefixed time.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T02:00:00.000Z').getTime() });
    onTestFinished(() => void vi.useRealTimers());
    const { container } = render(<Harness p={plan} />);
    const markers = [...container.querySelectorAll<HTMLElement>('[data-nav-key]')];
    const roomMarkers = markers.filter((m) => m.dataset.navKey!.startsWith('room:'));
    expect(roomMarkers).toHaveLength(8);
    expect(markers.every((m) => m.getAttribute('role') === 'button' && m.tabIndex === 0)).toBe(true);
    const a104 = roomMarkers.find((m) => m.getAttribute('aria-label')!.startsWith('A-104'))!;
    expect(a104.getAttribute('aria-label')).toMatch(/^A-104, Salle de TD A-104\. Occupied — teacher · until \d\d:\d\d$/);
    // North row (A-11x) comes before the south row (A-10x) in Tab order.
    const codes = roomMarkers.map((m) => m.getAttribute('aria-label')!.slice(0, 5));
    expect(codes.indexOf('A-111')).toBeLessThan(codes.indexOf('A-101'));
    // Status = class + pattern on the room shape, icon + pattern swatch on the label.
    expect(container.querySelectorAll('path.cw-room--TEACHER, path.cw-room--ADMIN')).toHaveLength(3);
    expect(container.querySelector('#cw-p-occupied')).not.toBeNull();
    expect(a104.querySelector('.pattern-stripes')).not.toBeNull();
  });

  it('arrow keys jump to the nearest item in that direction; Enter selects', async () => {
    const onSelect = vi.fn();
    const { container } = render(<Harness p={plan} onSelect={onSelect} />);
    const byCode = (code: string) => [...container.querySelectorAll<HTMLElement>('[data-nav-key^="room:"]')].find((m) => m.getAttribute('aria-label')!.startsWith(code))!;
    byCode('A-101').focus();
    fireEvent.keyDown(byCode('A-101'), { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^A-102/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/Toilets|A-112/);
    byCode('A-104').focus();
    fireEvent.keyDown(byCode('A-104'), { key: 'Enter', keyCode: 13 });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ kind: 'room', id: expect.any(String) }));
  });

  it('applies a live status change in place: focus kept, name updated, flash', () => {
    const { container, rerender } = render(<Harness p={plan} />);
    const a111 = [...container.querySelectorAll<HTMLElement>('[data-nav-key^="room:"]')].find((m) => m.getAttribute('aria-label')!.startsWith('A-111'))!;
    a111.focus();
    const next = structuredClone(plan);
    const f = next.layers.rooms!.features.find((x) => x.properties.code === 'A-111')!;
    f.properties.status = { ...f.properties.status, status: 'CLUB', label: 'Occupied — club', until: new Date(Date.now() + 3_600_000).toISOString() };
    rerender(<Harness p={next} />);
    expect(document.activeElement).toBe(a111); // same element, not rebuilt
    expect(a111.getAttribute('aria-label')).toMatch(/Occupied — club/);
    expect(a111.querySelector('.cw-label--CLUB')).not.toBeNull();
    expect(container.querySelector('path.cw-room--CLUB.is-flashing')).not.toBeNull();
  });
});

describe('live cache patch', () => {
  it('updates the floor plan, the room list and details from one room:status event', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.floor(plan.floor.id, 'en'), plan);
    qc.setQueryData(queryKeys.rooms({}, 'en'), rooms);
    const a111 = plan.layers.rooms!.features.find((x) => x.properties.code === 'A-111')!;
    const status = { ...a111.properties.status, status: 'TEACHER' as const, label: 'Occupied — teacher' };
    applyRoomStatus(qc, { roomId: a111.id, code: 'A-111', floorId: plan.floor.id, status, at: new Date().toISOString() });
    expect(qc.getQueryData<FloorPlan>(queryKeys.floor(plan.floor.id, 'en'))!.layers.rooms!.features.find((x) => x.id === a111.id)!.properties.status.status).toBe('TEACHER');
    expect(qc.getQueryData<RoomList>(queryKeys.rooms({}, 'en'))!.items.find((r) => r.id === a111.id)!.status.status).toBe('TEACHER');
  });
});

describe('Map page', () => {
  it('list view shows the same rooms and places, with roving arrow keys, and passes axe', async () => {
    const { container } = renderAt('/map?mode=list');
    const roomsSection = await screen.findByRole('region', { name: 'Rooms' }).catch(() => null);
    const list = roomsSection ?? (await screen.findByRole('heading', { name: 'Rooms', level: 2 })).parentElement!;
    const buttons = within(list).getAllByRole('button');
    expect(buttons.length).toBe(8);
    expect(buttons.some((b) => /A-104/.test(b.textContent ?? '') && /Occupied — teacher/.test(b.textContent ?? ''))).toBe(true);
    buttons[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(buttons[1]).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Places', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Closed passages', level: 2 })).toBeInTheDocument();
    expect(await axeViolations(container, { page: true })).toEqual([]);
  });

  it('deep link ?room=A-104 opens the detail panel with directions, save and today’s timeline', async () => {
    // "Now" depends on the clock: put it inside the first reservation of the captured schedule.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(roomA104.schedule[0]!.startsAt).getTime() + 10 * 60_000 });
    onTestFinished(() => void vi.useRealTimers());
    renderAt('/map?room=A-104&mode=list');
    const panel = await screen.findByRole('complementary', { name: 'A-104' });
    expect(await within(panel).findByText('Salle de TD A-104')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Get directions/ })).toHaveAttribute('href', '/navigate?to=room%3AA-104');
    const save = within(panel).getByRole('button', { name: /Save/ });
    expect(save).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(save);
    expect(within(panel).getByRole('button', { name: /Saved/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByText('Now')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Nearest facilities' })).toBeInTheDocument();
    const v = await axeViolations(panel);
    if (v.length) console.log("AXE", JSON.stringify(v, null, 1));
    expect(v).toEqual([]);
  });
});

describe('Find a room', () => {
  it('desktop: sortable table with "free" column, filters sent to the server, pagination', async () => {
    const { container, router } = renderAt('/rooms');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13); // header + 12 per page
    expect(screen.getByRole('status')).toHaveTextContent('44 rooms found');
    const capacity = within(table).getByRole('columnheader', { name: /Capacity/ });
    expect(capacity).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(capacity).getByRole('button'));
    expect(capacity).toHaveAttribute('aria-sort', 'descending');
    expect(router.state.location.search).toContain('sort=capacity');
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(firstRow.textContent).toMatch(/B-AMPHI1|A-BIB/);

    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/rooms' && c.params.status === 'CLUB')).toBe(true));
    expect(router.state.location.search).toContain('status=club');

    expect(screen.getByRole('navigation', { name: 'Result pages' })).toBeInTheDocument();
    const v = await axeViolations(container, { page: true });
    if (v.length) console.log('AXE', JSON.stringify(v));
    expect(v).toEqual([]);
  });

  it('phone: cards and a filters bottom sheet', async () => {
    window.innerWidth = 390;
    renderAt('/rooms');
    await screen.findAllByRole('article');
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(sheet).getByRole('button', { name: /Show \d+ rooms/ })).toBeInTheDocument();
  });
});

describe('Command palette: fuzzy search in AR / FR / EN', () => {
  it.each([
    ['bibliotheque', /A-BIB/],
    ['library', /A-BIB/],
    ['مكتبة', /A-BIB/],
    ['a104', /A-104/],
    ['robotics', /Robotics Club/],
    ['ascenseur', /Ascenseur Bloc/],
    ['elevator', /Ascenseur Bloc/],
  ])('"%s"', async (query, expected) => {
    const { router } = renderAt('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox', { name: /Search rooms/ });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/campus/search-index')).toBe(true));
    await act(async () => {
      await userEvent.type(input, query);
    });
    const options = await screen.findAllByRole('option');
    const match = options.find((o) => expected.test(o.textContent ?? ''));
    expect(match).toBeDefined();
    await userEvent.click(match!);
    expect(router.state.location.pathname).toBe('/map');
  });
});
