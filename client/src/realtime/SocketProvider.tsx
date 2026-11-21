/**
 * One Socket.io connection to /live per language (labels are localised server-side).
 * Usage: useSocketEvent('room:status', handler); useLiveSocket()?.emit(...)
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { io, type Socket } from 'socket.io-client';

type LiveContext = { socket: Socket | null; connected: boolean };

const Ctx = createContext<LiveContext>({ socket: null, connected: false });

/** Exposed for tests (a fake socket) and for embedding outside the provider. */
export const LiveSocketContext = Ctx;

export function SocketProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const { i18n } = useTranslation();
  const [state, setState] = useState<LiveContext>({ socket: null, connected: false });

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = io('/live', { auth: { lang: i18n.language }, transports: ['websocket', 'polling'] });
    setState({ socket, connected: socket.connected });
    const onConnect = () => setState({ socket, connected: true });
    const onDisconnect = () => setState({ socket, connected: false });
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
    };
  }, [enabled, i18n.language]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useLiveSocket(): LiveContext {
  return useContext(Ctx);
}

/** Subscribes to a server event for the lifetime of the component (latest handler always used). */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const { socket } = useLiveSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const listener = (payload: T) => ref.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
