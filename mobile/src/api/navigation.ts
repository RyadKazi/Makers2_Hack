import { apiRequest } from './client';
import type { RouteLocation, RoutePlan, Locale } from '@/types/api';

export type PlanRouteInput = {
  from: RouteLocation;
  to: RouteLocation;
  mode?: 'walking' | 'wheelchair';
  options?: ('fastest' | 'step-free')[];
  constraints?: { useProfile?: boolean; avoidStairs?: boolean; maxSlopePercent?: number | null; minDoorWidthCm?: number | null; verifiedRampsOnly?: boolean; verifiedOnly?: boolean };
  shorelineHints?: boolean;
  lang: Locale;
};

export const navigationApi = {
  plan: (input: PlanRouteInput) => apiRequest<RoutePlan>('/routes/plan', { method: 'POST', body: input, auth: false, locale: input.lang }),
};
