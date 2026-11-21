import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { queryKeys } from '@/api/hooks';
import type { RoomDetail, SearchIndex } from '@/api/types';
import type { Lang } from '@/stores/preferences';
import type { Place } from './PlaceSearch';
import { sameCode, SOURCE_ACCURACY, type Checkpoint, type Position, type PositionSource } from './position';

/** Checkpoint → place, using the search index (codes compared loosely: "a104" = "A-104"). */
export function placeOfCheckpoint(cp: Checkpoint, index: SearchIndex, lang: Lang): Place | null {
  if (cp.kind === 'poi') {
    const p = index.pois.find((x) => x.id === cp.id);
    return p ? { kind: 'poi', id: p.id, label: lang === 'ar' && p.nameAr ? p.nameAr : p.name, level: p.level, floorId: p.floorId, x: p.x, y: p.y } : null;
  }
  const r = index.rooms.find((x) => sameCode(x.code, cp.id));
  return r ? { kind: 'room', id: r.code, label: `${r.code} · ${lang === 'ar' && r.nameAr ? r.nameAr : r.name}`, level: r.level, floorId: r.floorId } : null;
}

/** Place → position (rooms need their coordinates from the room detail). */
export function useResolvePosition() {
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  return useCallback(
    async (place: Place, source: Exclude<PositionSource, 'simulator' | 'geolocation'>): Promise<Omit<Position, 'at'> | null> => {
      const accuracyM = SOURCE_ACCURACY[source];
      if (place.kind === 'poi') return { x: place.x, y: place.y, level: place.level, floorId: place.floorId, accuracyM, source, label: place.label };
      if (place.kind !== 'room') return null;
      const room = await qc.fetchQuery({
        queryKey: queryKeys.room(place.id, i18n.language),
        queryFn: async () => (await api.get<RoomDetail>(`/api/rooms/${encodeURIComponent(place.id)}`, { params: { lang: i18n.language } })).data,
        staleTime: 60_000,
      });
      return { x: room.x, y: room.y, level: room.floor.level, floorId: room.floor.id, accuracyM, source, label: place.label };
    },
    [qc, i18n.language],
  );
}
