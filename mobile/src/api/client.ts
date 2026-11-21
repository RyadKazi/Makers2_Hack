import * as SecureStore from 'expo-secure-store';
import type { AuthSession, Locale } from '@/types/api';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000/api').replace(/\/$/, '');
const ACCESS_TOKEN_KEY = 'accesu.access-token';
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function setStoredAccessToken(token: string | null) {
  accessToken = token;
  if (token) await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
}

export async function getStoredAccessToken() {
  if (accessToken) return accessToken;
  accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  return accessToken;
}

function languageHeader(locale?: Locale): Record<string,string> {
  return locale ? { 'Accept-Language': locale } : {};
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const session = (await response.json()) as AuthSession;
      if (!session?.accessToken) return null;
      await setStoredAccessToken(session.accessToken);
      return session.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function decodeError(response: Response): Promise<ApiError> {
  let data: any = null;
  try { data = await response.json(); } catch { /* non-JSON upstream errors */ }
  const error = data?.error;
  return new ApiError(response.status, error?.code ?? 'REQUEST_FAILED', error?.message ?? `Request failed (${response.status})`, error?.details);
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  locale?: Locale;
  retryAuth?: boolean;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false, locale, retryAuth = true } = options;
  const token = auth ? await getStoredAccessToken() : null;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if(locale)headers['Accept-Language']=locale;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the AccesU server. Check the address and your connection.');
  }

  if (response.status === 401 && auth && retryAuth && path !== '/auth/refresh') {
    const renewed = await refreshAccessToken();
    if (renewed) return apiRequest<T>(path, { ...options, retryAuth: false });
  }
  if (!response.ok) throw await decodeError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function requestBinary(path: string, body: unknown, locale: Locale): Promise<ArrayBuffer> {
  const token = await getStoredAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg', ...(token?{Authorization:`Bearer ${token}`} : {}), ...languageHeader(locale) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await decodeError(response);
  return response.arrayBuffer();
}

export function getApiBaseUrl() { return API_BASE_URL; }
export { refreshAccessToken };
