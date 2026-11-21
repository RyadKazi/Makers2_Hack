import { apiRequest } from './client';
import type { SpeechStatus, Locale } from '@/types/api';

// The server supports TTS, but this first mobile release intentionally uses the
// user-requested static prototype. This query is informational only.
export const speechApi = { status: (locale: Locale) => apiRequest<SpeechStatus>(`/speech/status?lang=${locale}`, { locale }) };
