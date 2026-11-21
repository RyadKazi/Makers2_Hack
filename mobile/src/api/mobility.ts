import { apiRequest } from './client';
import type { DifficultyType, Locale, MobilityConsent, MobilityProfile, MobilityStatus } from '@/types/api';

export const mobilityApi = {
  consent: (locale: Locale) => apiRequest<MobilityConsent>(`/mobility/consent?lang=${locale}`, { auth: true, locale }),
  grantConsent: (policyVersion: string, locale: Locale) => apiRequest<MobilityConsent>('/mobility/consent', { method: 'POST', body: { policyVersion, lang: locale }, auth: true, locale }),
  revokeConsent: (deleteData: boolean, locale: Locale) => apiRequest<{ endedSession: boolean; deleted: unknown; consent: MobilityConsent }>('/mobility/consent?deleteData=' + deleteData, { method: 'DELETE', auth: true, locale }),
  deleteData: () => apiRequest<{ deleted: { sessions: number; points: number; events: number } }>('/mobility/data', { method: 'DELETE', auth: true }),
  current: (locale: Locale) => apiRequest<MobilityStatus>(`/mobility/sessions/current?lang=${locale}`, { auth: true, locale }),
  start: (needsCategory: MobilityProfile, locale: Locale) => apiRequest<MobilityStatus>('/mobility/sessions', { method: 'POST', body: { needsCategory, lang: locale }, auth: true, locale }),
  stop: (id: string, locale: Locale) => apiRequest<MobilityStatus>(`/mobility/sessions/${encodeURIComponent(id)}/stop?lang=${locale}`, { method: 'POST', auth: true, locale }),
  // EventBody is strict and does not accept a lang field. The locale header is
  // still sent for consistent request handling without changing the payload.
  report: (body: { sessionId: string; type: DifficultyType; note?: string; x: number; y: number; level: number; floorId?: string; recordedAt?: string }, locale: Locale) => apiRequest<{ id: string; type: string; edgeId: string | null; recordedAt: string }>('/mobility/events', { method: 'POST', body, auth: true, locale }),
};
