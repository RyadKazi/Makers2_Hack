import { apiRequest, setStoredAccessToken } from './client';
import type { AccessibilityProfile, AuthSession, Locale, User } from '@/types/api';

export const authApi = {
  async login(email: string, password: string) {
    const session = await apiRequest<AuthSession>('/auth/login', { method: 'POST', body: { email, password } });
    await setStoredAccessToken(session.accessToken);
    return session.user;
  },
  async register(displayName: string, email: string, password: string, locale: Locale) {
    const session = await apiRequest<AuthSession>('/auth/register', { method: 'POST', body: { displayName, email, password, locale } });
    await setStoredAccessToken(session.accessToken);
    return session.user;
  },
  async refresh() {
    const session = await apiRequest<AuthSession>('/auth/refresh', { method: 'POST', retryAuth: false });
    await setStoredAccessToken(session.accessToken);
    return session.user;
  },
  currentUser: (locale?: Locale) => apiRequest<User>('/me', { auth: true, locale }),
  async logout() {
    try { await apiRequest<void>('/auth/logout', { method: 'POST', retryAuth: false }); } finally { await setStoredAccessToken(null); }
  },
  updateMe: (body: { displayName?: string; locale?: Locale }) => apiRequest<User>('/me', { method: 'PUT', body, auth: true }),
  getAccessibility: (locale?: Locale) => apiRequest<AccessibilityProfile>('/me/accessibility-profile', { auth: true, locale }),
  updateAccessibility: (body: Partial<AccessibilityProfile>) => apiRequest<AccessibilityProfile>('/me/accessibility-profile', { method: 'PUT', body, auth: true }),
};
