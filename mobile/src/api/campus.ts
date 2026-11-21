import { apiRequest } from './client';
import type { Building, CampusOverview, FloorPlan, Locale, SearchIndex } from '@/types/api';

export const campusApi = {
  overview: (locale: Locale) => apiRequest<CampusOverview>(`/campus?lang=${locale}`, { locale }),
  buildings: (locale: Locale) => apiRequest<{ items: Building[] }>(`/campus/buildings?lang=${locale}`, { locale }),
  floorPlan: (floorId: string, locale: Locale) => apiRequest<FloorPlan>(`/campus/floors/${encodeURIComponent(floorId)}?lang=${locale}`, { locale }),
  searchIndex: (locale: Locale) => apiRequest<SearchIndex>(`/campus/search-index?lang=${locale}`, { locale }),
};
