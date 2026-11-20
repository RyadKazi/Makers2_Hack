/**
 * Namespace /live — read-only campus status, one Socket.io room per floor.
 *
 * Client → server
 *   "floor:join"  { floorId }  ack → { ok: true, statuses: RoomStatusEvent[] } | { ok: false, error }
 *   "floor:leave" { floorId }
 *   floorId "outdoor" = paths outside the buildings (edge:status only).
 *   Label language: handshake `auth.lang` or `?lang=` (ar | fr | en, default fr).
 *
 * Server → client
 *   "room:status" RoomStatusEvent   on reservation create/update/delete and at start/end (cron, every minute)
 *   "edge:status" EdgeStatusEvent   when an admin opens/closes a passage
 *
 * Navigation
 *   "route:watch" / "route:unwatch" { routeId }
 *   "route:invalidated" RouteInvalidatedEvent  a passage on the route closed, or /recheck rerouted
 */
import type { Namespace, Server, Socket } from 'socket.io';
import { z } from 'zod';
import { bus, type DomainEvents } from '../lib/events.js';
import { DEFAULT_LANG, isLang, LANGS, type Lang } from '../lib/i18n.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { edgeFloorIds } from '../modules/campus/campus.repository.js';
import { roomStatusEvents } from '../modules/rooms/rooms.service.js';
import { toRoomStatusDto } from '../modules/rooms/status.js';

export const LIVE_NAMESPACE = '/live';
export const OUTDOOR = 'outdoor';
const MAX_FLOORS_PER_SOCKET = 12;
const LIVE_ACTION_LIMIT = 60;
const LIVE_ACTION_WINDOW_MS = 60_000;

export type RoomStatusEvent = {
  roomId: string;
  code: string;
  floorId: string;
  status: ReturnType<typeof toRoomStatusDto>;
  at: string;
};

export type EdgeStatusEvent = {
  edgeId: string;
  floorId: string;
  isOpen: boolean;
  closedReason: string | null;
  at: string;
};

const JoinPayload = z.object({ floorId: z.string().min(1).max(64) });
const RoutePayload = z.object({ routeId: z.uuid() });

/** Sent to clients watching a route (`route:watch`). Recheck to get the new route when rerouted is false. */
export type RouteInvalidatedEvent = DomainEvents['route.invalidated'] & { at: string };

const routeRoom = (routeId: string): string => `route:${routeId}`;

const roomName = (floorId: string, lang: Lang): string => `floor:${floorId}:${lang}`;

function socketLang(socket: Socket): Lang {
  const fromAuth = (socket.handshake.auth as Record<string, unknown> | undefined)?.lang;
  const fromQuery = socket.handshake.query.lang;
  if (isLang(fromAuth)) return fromAuth;
  if (isLang(fromQuery)) return fromQuery;
  return DEFAULT_LANG;
}

type Ack = (response: unknown) => void;

async function floorExists(floorId: string): Promise<boolean> {
  if (floorId === OUTDOOR) return true;
  return (await prisma.floor.count({ where: { id: floorId } })) > 0;
}

export function attachLiveNamespace(io: Server): { namespace: Namespace; dispose: () => void } {
  const nsp = io.of(LIVE_NAMESPACE);

  nsp.on('connection', (socket) => {
    const lang = socketLang(socket);
    socket.data.lang = lang;
    socket.data.floors = new Set<string>();
    socket.data.liveActions = { startedAt: Date.now(), count: 0 };

    const rateLimited = (): boolean => {
      const now = Date.now();
      const bucket = socket.data.liveActions as { startedAt: number; count: number };
      if (now - bucket.startedAt >= LIVE_ACTION_WINDOW_MS) {
        bucket.startedAt = now;
        bucket.count = 0;
      }
      bucket.count += 1;
      return bucket.count > LIVE_ACTION_LIMIT;
    };

    socket.on('floor:join', async (payload: unknown, ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      if (rateLimited()) return reply({ ok: false, error: 'RATE_LIMITED' });
      const parsed = JoinPayload.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: 'INVALID_PAYLOAD' });
      const { floorId } = parsed.data;
      const floors = socket.data.floors as Set<string>;
      if (!floors.has(floorId) && floors.size >= MAX_FLOORS_PER_SOCKET) return reply({ ok: false, error: 'TOO_MANY_FLOORS' });

      try {
        if (!(await floorExists(floorId))) return reply({ ok: false, error: 'FLOOR_NOT_FOUND' });
        await socket.join(roomName(floorId, lang));
        floors.add(floorId);
        const now = new Date();
        const statuses: RoomStatusEvent[] =
          floorId === OUTDOOR
            ? []
            : (await roomStatusEvents({ floorId }, now)).map((e) => ({ ...e, status: toRoomStatusDto(e.status, lang), at: now.toISOString() }));
        reply({ ok: true, statuses });
      } catch (err) {
        logger.error({ err, floorId }, 'floor:join failed');
        reply({ ok: false, error: 'INTERNAL_ERROR' });
      }
    });

    socket.on('route:watch', async (payload: unknown, ack?: Ack) => {
      if (rateLimited()) {
        if (typeof ack === 'function') ack({ ok: false, error: 'RATE_LIMITED' });
        return;
      }
      const parsed = RoutePayload.safeParse(payload);
      if (parsed.success) await socket.join(routeRoom(parsed.data.routeId));
      if (typeof ack === 'function') ack(parsed.success ? { ok: true } : { ok: false, error: 'INVALID_PAYLOAD' });
    });

    socket.on('route:unwatch', async (payload: unknown, ack?: Ack) => {
      const parsed = RoutePayload.safeParse(payload);
      if (parsed.success) await socket.leave(routeRoom(parsed.data.routeId));
      if (typeof ack === 'function') ack({ ok: parsed.success });
    });

    socket.on('floor:leave', async (payload: unknown, ack?: Ack) => {
      const parsed = JoinPayload.safeParse(payload);
      if (parsed.success) {
        await socket.leave(roomName(parsed.data.floorId, lang));
        (socket.data.floors as Set<string>).delete(parsed.data.floorId);
      }
      if (typeof ack === 'function') ack({ ok: parsed.success });
    });
  });

  const offRooms = bus.on('rooms.changed', ({ roomIds }) => {
    void (async () => {
      const now = new Date();
      for (const event of await roomStatusEvents({ roomIds }, now)) {
        for (const l of LANGS) {
          const payload: RoomStatusEvent = { ...event, status: toRoomStatusDto(event.status, l), at: now.toISOString() };
          nsp.to(roomName(event.floorId, l)).emit('room:status', payload);
        }
      }
    })().catch((err: unknown) => logger.error({ err }, 'room:status broadcast failed'));
  });

  const offEdges = bus.on('edge.changed', ({ edgeId }) => {
    void (async () => {
      const edge = await prisma.navEdge.findUnique({ where: { id: edgeId }, select: { id: true, isOpen: true, closedReason: true } });
      if (!edge) return;
      const at = new Date().toISOString();
      for (const floorId of await edgeFloorIds(edgeId)) {
        const target = floorId ?? OUTDOOR;
        const payload: EdgeStatusEvent = { edgeId: edge.id, floorId: target, isOpen: edge.isOpen, closedReason: edge.closedReason, at };
        for (const l of LANGS) nsp.to(roomName(target, l)).emit('edge:status', payload);
      }
    })().catch((err: unknown) => logger.error({ err }, 'edge:status broadcast failed'));
  });

  const offRoutes = bus.on('route.invalidated', (event) => {
    const payload: RouteInvalidatedEvent = { ...event, at: new Date().toISOString() };
    nsp.to(routeRoom(event.routeId)).emit('route:invalidated', payload);
  });

  return {
    namespace: nsp,
    dispose: () => {
      offRooms();
      offEdges();
      offRoutes();
    },
  };
}
