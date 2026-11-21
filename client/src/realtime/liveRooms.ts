/**
 * Live room status: joins the Socket.io floor rooms we display, and patches the
 * TanStack Query cache in place on "room:status" (no refetch, no flicker).
 * "edge:status" (a passage opened / closed) refetches the affected floor plans.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { FloorPlan, RoomDetail, RoomList, RoomStatus } from '@/api/types';
import { queryKeys } from '@/api/hooks';
import { useLiveSocket, useSocketEvent } from './SocketProvider';

export type RoomStatusEvent = { roomId: string; code: string; floorId: string; status: RoomStatus; at: string };
export type EdgeStatusEvent = { edgeId: string; floorId: string; isOpen: boolean; closedReason: string | null; at: string };

/** Pure cache patch, exported for tests. */
export function applyRoomStatus(qc: QueryClient, e: RoomStatusEvent): void {
  qc.setQueriesData<FloorPlan>({ queryKey: queryKeys.floorAll }, (plan) => {
    if (!plan?.layers.rooms || plan.floor.id !== e.floorId) return plan;
    return {
      ...plan,
      layers: {
        ...plan.layers,
        rooms: { ...plan.layers.rooms, features: plan.layers.rooms.features.map((f) => (f.id === e.roomId ? { ...f, properties: { ...f.properties, status: e.status } } : f)) },
      },
    };
  });
  qc.setQueriesData<RoomList>({ queryKey: [...queryKeys.roomsAll, 'list'] }, (list) =>
    list ? { ...list, items: list.items.map((r) => (r.id === e.roomId ? { ...r, status: e.status } : r)) } : list,
  );
  qc.setQueriesData<RoomDetail>({ queryKey: [...queryKeys.roomsAll, 'detail'] }, (room) => (room && room.id === e.roomId ? { ...room, status: e.status } : room));
  // The schedule may have changed (new / cancelled reservation): refresh details in the background.
  void qc.invalidateQueries({ queryKey: [...queryKeys.roomsAll, 'detail'], refetchType: 'active' });
}

/** Joins the given floors (and "outdoor" when asked) for as long as the component is mounted. */
export function useLiveFloors(floorIds: readonly string[], onRoomStatus?: (e: RoomStatusEvent) => void): void {
  const { socket, connected } = useLiveSocket();
  const qc = useQueryClient();
  const callback = useRef(onRoomStatus);
  callback.current = onRoomStatus;
  const key = [...new Set(floorIds)].sort().join(',');

  useEffect(() => {
    if (!socket || !connected || !key) return undefined;
    const ids = key.split(',');
    for (const floorId of ids) socket.emit('floor:join', { floorId });
    return () => {
      for (const floorId of ids) socket.emit('floor:leave', { floorId });
    };
  }, [socket, connected, key]);

  useSocketEvent<RoomStatusEvent>('room:status', (e) => {
    applyRoomStatus(qc, e);
    callback.current?.(e);
  });
  useSocketEvent<EdgeStatusEvent>('edge:status', () => {
    void qc.invalidateQueries({ queryKey: queryKeys.floorAll });
    void qc.invalidateQueries({ queryKey: queryKeys.overview });
  });
}
