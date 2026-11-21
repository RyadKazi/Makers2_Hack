import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/stores/auth';
import { api } from './client';
import type { AccessibilityProfile, AuthSession, BuildingList, CampusOverview, FloorPlan, Me, Reservation, RoomDetail, RoomList, SearchIndex, UpdateAccessibilityProfile } from './types';

/** Localised payloads (status labels) are cached per language. */
export const queryKeys = {
  me: ['me'] as const,
  buildings: ['campus', 'buildings'] as const,
  overview: ['campus', 'overview'] as const,
  searchIndex: ['campus', 'search-index'] as const,
  floor: (floorId: string, lang: string) => ['campus', 'floor', floorId, lang] as const,
  floorAll: ['campus', 'floor'] as const,
  rooms: (params: Record<string, unknown>, lang: string) => ['rooms', 'list', params, lang] as const,
  roomsAll: ['rooms'] as const,
  room: (idOrCode: string, lang: string) => ['rooms', 'detail', idOrCode, lang] as const,
};

export function useBuildings() {
  return useQuery({
    queryKey: queryKeys.buildings,
    queryFn: async () => (await api.get<BuildingList>('/api/campus/buildings')).data,
    staleTime: 10 * 60_000,
  });
}

export function useCampusOverview(enabled = true) {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: async () => (await api.get<CampusOverview>('/api/campus')).data,
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useFloorPlan(floorId: string | null) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: queryKeys.floor(floorId ?? '-', i18n.language),
    queryFn: async ({ signal }) => (await api.get<FloorPlan>(`/api/campus/floors/${floorId}`, { params: { lang: i18n.language }, signal })).data,
    enabled: !!floorId,
    staleTime: 60_000,
  });
}

export function useSearchIndex(enabled = true) {
  return useQuery({
    queryKey: queryKeys.searchIndex,
    queryFn: async () => (await api.get<SearchIndex>('/api/campus/search-index')).data,
    staleTime: 5 * 60_000,
    enabled,
  });
}

export type RoomQuery = { status?: string | undefined; buildingId?: string | undefined; floor?: number | undefined; minCapacity?: number | undefined; stepFree?: boolean | undefined };

export function useRooms(params: RoomQuery = {}, enabled = true) {
  const { i18n } = useTranslation();
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  return useQuery({
    queryKey: queryKeys.rooms(clean, i18n.language),
    queryFn: async ({ signal }) => (await api.get<RoomList>('/api/rooms', { params: { ...clean, limit: 200, lang: i18n.language }, signal })).data,
    staleTime: 30_000,
    refetchInterval: 60_000, // safety net besides live socket updates
    enabled,
  });
}

export function useRoom(idOrCode: string | null) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: queryKeys.room(idOrCode ?? '-', i18n.language),
    queryFn: async ({ signal }) => (await api.get<RoomDetail>(`/api/rooms/${encodeURIComponent(idOrCode!)}`, { params: { lang: i18n.language }, signal })).data,
    enabled: !!idOrCode,
    staleTime: 30_000,
  });
}

export function useRoomSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['rooms', 'search', q] as const,
    queryFn: async ({ signal }) => (await api.get<RoomList>('/api/rooms', { params: { search: q, limit: 8 }, signal })).data,
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const setSession = useAuth((s) => s.setSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { email: string; password: string }) => (await api.post<AuthSession>('/api/auth/login', body)).data,
    onSuccess: (session) => {
      setSession(session.accessToken, session.user);
      qc.setQueryData(queryKeys.me, session.user);
    },
  });
}

export function useLogout() {
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (everywhere: boolean) => {
      await api.post(everywhere ? '/api/auth/logout-all' : '/api/auth/logout');
    },
    onSettled: () => {
      clear();
      qc.clear();
    },
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  const setUser = useAuth((s) => s.setUser);
  return useMutation({
    mutationFn: async (body: UpdateAccessibilityProfile) => (await api.put<AccessibilityProfile>('/api/me/accessibility-profile', body)).data,
    onSuccess: (profile) => {
      const me = useAuth.getState().user;
      if (me) {
        const next: Me = { ...me, accessibilityProfile: profile };
        setUser(next);
        qc.setQueryData(queryKeys.me, next);
      }
    },
  });
}

export type CreateReservationInput = {
  roomId: string;
  kind: 'TEACHER' | 'ADMIN' | 'CLUB';
  title: string;
  organizer?: string;
  startsAt: string;
  endsAt: string;
};

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateReservationInput) => (await api.post<Reservation>('/api/reservations', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      void qc.invalidateQueries({ queryKey: queryKeys.floorAll });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useCancelReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/reservations/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      void qc.invalidateQueries({ queryKey: queryKeys.floorAll });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

// ───────── Admin Hooks ─────────

export type AdminStats = {
  generatedAt: string;
  kMin: number;
  retentionDays: number;
  sessions: { active: number; today: number; last7d: number };
  contributors: { today: number | null; last7d: number | null };
  categories7d: Array<{ category: string; sessions: number; contributors: number }>;
  events7d: { reported: Record<string, number>; detected: Record<string, number> };
  rawData: { points: number; oldestPointAt: string | null };
  queue: { pendingCorrections: number; openRecommendations: number; hotspots: number };
  lastAggregationAt: string | null;
};

export type AdminHotspot = {
  id: string;
  level: number;
  floorId: string | null;
  x: number;
  y: number;
  radiusM: number;
  eventCount: number;
  contributorCount: number;
  dominantType: string;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  edge: {
    id: string;
    description: string;
    hasStairs: boolean;
    isRamp: boolean;
    slopePercent: number;
    widthCm: number;
    isOpen: boolean;
  } | null;
  computedAt: string;
};

export type AdminRecommendation = {
  id: string;
  kind: 'RAMP' | 'ELEVATOR' | 'WIDEN_DOOR' | 'ACCESSIBLE_ENTRANCE' | 'SIGNAGE';
  status: 'OPEN' | 'PLANNED' | 'DONE' | 'DISMISSED';
  title: string;
  rationale: string;
  score: number;
  evidence: Record<string, unknown>;
  level: number;
  x: number;
  y: number;
  edgeId: string | null;
  updatedAt: string;
};

export type FloorSvgItem = {
  floorId: string;
  buildingId: string;
  buildingCode: string;
  buildingName: string;
  level: number;
  floorName: string;
  roomCount: number;
  hasCustomSvg: boolean;
  updatedAt: string | null;
};

export type FloorSvgDetail = {
  floorId: string;
  buildingCode: string;
  buildingName: string;
  level: number;
  floorName: string;
  svgContent: string;
  isCustom: boolean;
  updatedAt: string;
};

export function useAdminStats(enabled = true) {
  return useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => (await api.get<AdminStats>('/api/admin/stats')).data,
    enabled,
    refetchInterval: 30_000,
  });
}

export function useAdminHotspots(level?: number, enabled = true) {
  return useQuery<{ kMin: number; items: AdminHotspot[] }>({
    queryKey: ['admin', 'hotspots', level],
    queryFn: async () =>
      (await api.get<{ kMin: number; items: AdminHotspot[] }>('/api/admin/hotspots', { params: level !== undefined ? { level } : {} })).data,
    enabled,
  });
}

export function useAdminRecommendations(enabled = true) {
  return useQuery<{ formula: string; items: AdminRecommendation[] }>({
    queryKey: ['admin', 'recommendations'],
    queryFn: async () => (await api.get<{ formula: string; items: AdminRecommendation[] }>('/api/admin/recommendations')).data,
    enabled,
  });
}

export function useUpdateRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'OPEN' | 'PLANNED' | 'DONE' | 'DISMISSED' }) =>
      (await api.patch<AdminRecommendation>(`/api/admin/recommendations/${id}`, { status })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'recommendations'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
  });
}

export function useFloorSvgList(enabled = true) {
  return useQuery<{ items: FloorSvgItem[] }>({
    queryKey: ['admin', 'floors', 'svgs'],
    queryFn: async () => (await api.get<{ items: FloorSvgItem[] }>('/api/admin/floors/svgs')).data,
    enabled,
  });
}

export function useFloorSvg(floorId: string | null, enabled = true) {
  return useQuery<FloorSvgDetail>({
    queryKey: ['admin', 'floors', floorId, 'svg'],
    queryFn: async () => (await api.get<FloorSvgDetail>(`/api/admin/floors/${floorId}/svg`)).data,
    enabled: enabled && !!floorId,
  });
}

export function useSaveFloorSvg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ floorId, svgContent }: { floorId: string; svgContent: string }) =>
      (await api.put<FloorSvgDetail>(`/api/admin/floors/${floorId}/svg`, { svgContent })).data,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'floors', 'svgs'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'floors', vars.floorId, 'svg'] });
    },
  });
}

export function usePlanCustomRoute() {
  return useMutation({
    mutationFn: async (req: import('@/api/types').PlanRouteRequest) =>
      (await api.post<import('@/api/types').RoutePlan>('/api/routes/plan', req)).data,
  });
}

