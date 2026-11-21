/**
 * HTTP client. Same-origin (Vite proxies /api), JSON, Accept-Language from i18n.
 * Access token from the auth store; on 401 the refresh cookie is used ONCE
 * (concurrent requests share the same refresh) and the request is replayed.
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { currentLang } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { ApiError, AuthSession } from './types';

export const api = axios.create({ baseURL: '/', withCredentials: true, timeout: 15_000 });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  config.headers.set('Accept-Language', currentLang());
  return config;
});

let refreshing: Promise<AuthSession | null> | null = null;

/** Exchanges the refresh cookie for a new session. Shared by concurrent callers. */
export function refreshSession(): Promise<AuthSession | null> {
  refreshing ??= axios
    .post<AuthSession>('/api/auth/refresh', null, { withCredentials: true, timeout: 10_000 })
    .then((res) => {
      useAuth.getState().setSession(res.data.accessToken, res.data.user);
      return res.data;
    })
    .catch(() => {
      useAuth.getState().clear();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type RetriableConfig = AxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(undefined, async (error: AxiosError<ApiError>) => {
  const config = error.config as RetriableConfig | undefined;
  const code = error.response?.data?.error?.code;
  const isAuthCall = config?.url?.startsWith('/api/auth/');
  if (error.response?.status === 401 && config && !config._retried && !isAuthCall && (code === 'INVALID_TOKEN' || code === 'UNAUTHORIZED')) {
    config._retried = true;
    const session = await refreshSession();
    if (session) return api.request(config);
  }
  throw error;
});

/** Error code from an API error response (or NETWORK / UNKNOWN). */
export function errorCode(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return 'NETWORK';
    return (err.response.data as ApiError | undefined)?.error?.code ?? `HTTP_${err.response.status}`;
  }
  return 'UNKNOWN';
}
