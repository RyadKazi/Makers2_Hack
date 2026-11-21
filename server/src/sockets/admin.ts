/**
 * Namespace /admin — live dashboard for administrators (aggregates only).
 * Handshake: io('/admin', { auth: { token: '<access token of an ADMIN>' } }).
 *
 * Server → client
 *   "stats"               MobilityStats      on connect, after each aggregation, and (throttled) when sessions start/stop
 *   "mobility:aggregated" summary            heatmap / hotspots / recommendations recomputed (refetch what you show)
 *   "correction:updated"  { id, status, created }
 *   "recommendation:updated" { id, status } (admin changes; engine refreshes come with mobility:aggregated)
 */
import type { Namespace, Server } from 'socket.io';
import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { stats } from '../modules/admin/admin.service.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export const ADMIN_NAMESPACE = '/admin';
const STATS_THROTTLE_MS = 10_000;

export function attachAdminNamespace(io: Server): { namespace: Namespace; dispose: () => void } {
  const nsp = io.of(ADMIN_NAMESPACE);

  nsp.use((socket, next) => {
    const token = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
    const payload = typeof token === 'string' ? verifyAccessToken(token) : null;
    if (!payload || payload.role !== 'ADMIN') return next(new Error('FORBIDDEN'));
    socket.data.userId = payload.userId;
    next();
  });

  const pushStats = async (target: { emit: (event: string, payload: unknown) => unknown } = nsp) => {
    try {
      target.emit('stats', await stats(new Date()));
    } catch (err) {
      logger.error({ err }, 'admin stats push failed');
    }
  };

  nsp.on('connection', (socket) => void pushStats(socket));

  let timer: NodeJS.Timeout | null = null;
  const throttledStats = () => {
    if (timer || nsp.sockets.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void pushStats();
    }, STATS_THROTTLE_MS);
  };

  const offs = [
    bus.on('mobility.aggregated', (summary) => {
      nsp.emit('mobility:aggregated', summary);
      void pushStats();
    }),
    bus.on('admin.correction', (e) => {
      nsp.emit('correction:updated', e);
      if (!e.created) throttledStats();
    }),
    bus.on('admin.recommendation', (e) => {
      if (e.status !== 'OPEN') nsp.emit('recommendation:updated', e);
    }),
    bus.on('mobility.sessionStarted', throttledStats),
    bus.on('mobility.sessionEnded', throttledStats),
  ];

  return {
    namespace: nsp,
    dispose: () => {
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    },
  };
}
