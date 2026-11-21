/**
 * Session state. The access token lives in memory only (never localStorage, so an
 * XSS cannot read a long-lived credential); the refresh token is an httpOnly cookie.
 */
import { create } from 'zustand';
import type { Me } from '@/api/types';

type AuthState = {
  status: 'unknown' | 'anonymous' | 'authenticated';
  accessToken: string | null;
  user: Me | null;
  setSession: (accessToken: string, user: Me) => void;
  setUser: (user: Me) => void;
  clear: () => void;
};

export const useAuth = create<AuthState>()((set) => ({
  status: 'unknown',
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ status: 'authenticated', accessToken, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ status: 'anonymous', accessToken: null, user: null }),
}));
