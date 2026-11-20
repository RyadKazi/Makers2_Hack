import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { attachAdminNamespace } from './admin.js';
import { attachLiveNamespace } from './live.js';

/** Socket.io server. Namespaces: /live (room, passage and route status), /admin (mobility dashboard). */
export function createSocketServer(httpServer: HttpServer): { io: Server; close: () => Promise<void> } {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
  });
  const live = attachLiveNamespace(io);
  const admin = attachAdminNamespace(io);
  return {
    io,
    close: async () => {
      live.dispose();
      admin.dispose();
      await io.close();
    },
  };
}
