import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '@/api/auth';
import { ApiError, getStoredAccessToken, refreshAccessToken, setStoredAccessToken } from '@/api/client';
import type { Locale, User } from '@/types/api';

type AuthValue = {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, locale: Locale) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthValue['status']>('loading');

  const refreshUser = useCallback(async () => {
    const me = await authApi.currentUser();
    setUser(me);
    setStatus('authenticated');
  }, []);

  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      try {
        // Restore the short-lived bearer token first, then use the backend's
        // HttpOnly refresh cookie if the token is missing or has expired.
        let token = await getStoredAccessToken();
        if (!token) token = await refreshAccessToken();
        if (!token) {
          if (mounted) setStatus('anonymous');
          return;
        }
        const me = await authApi.currentUser();
        if (mounted) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch (error) {
        // Keep a stored token after network failures so a temporary outage does
        // not destroy a valid session. Clear it when the server rejects it.
        if (error instanceof ApiError && error.status === 401) await setStoredAccessToken(null);
        if (mounted) {
          setUser(null);
          setStatus('anonymous');
        }
      }
    };
    void restoreSession();
    return () => { mounted = false; };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await authApi.login(email, password);
    setUser(next);
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (name: string, email: string, password: string, locale: Locale) => {
    const next = await authApi.register(name, email, password, locale);
    setUser(next);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(() => ({ user, status, signIn, register, signOut, refreshUser }), [user, status, signIn, register, signOut, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

export function toUserFacingError(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
