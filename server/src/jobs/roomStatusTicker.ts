import { schedule, type ScheduledTask } from 'node-cron';
import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

/** Rooms where a reservation started or ended in (from, to]. */
export async function findStatusTransitions(from: Date, to: Date): Promise<string[]> {
  const rows = await prisma.reservation.findMany({
    where: { OR: [{ startsAt: { gt: from, lte: to } }, { endsAt: { gt: from, lte: to } }] },
    select: { roomId: true },
    distinct: ['roomId'],
  });
  return rows.map((r) => r.roomId);
}

/**
 * Every minute (at :01 s, so a session starting at 08:00:00 is already running),
 * publishes `rooms.changed` for rooms whose reservations started or ended since the
 * last tick. The socket layer turns that into `room:status` events.
 */
export function startRoomStatusTicker(): ScheduledTask {
  let last = new Date();
  return schedule(
    '1 * * * * *',
    async () => {
      const now = new Date();
      try {
        const roomIds = await findStatusTransitions(last, now);
        last = now;
        if (roomIds.length > 0) {
          logger.debug({ rooms: roomIds.length }, 'room status transitions');
          bus.emit('rooms.changed', { roomIds });
        }
      } catch (err) {
        // Keep `last` so the next tick covers the missed window.
        logger.error({ err }, 'room status ticker failed');
      }
    },
    { name: 'room-status-ticker', noOverlap: true },
  );
}
