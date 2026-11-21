import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '@/api/auth';
import { ApiError, refreshAccessToken, setStoredAccessToken } from '@/api/client';
import type { Locale, User } from '@/types/api';

export const DEFAULT_DEMO_USER: User = {
  id: 'user-demo-student',
  email: 'student@campusway.local',
  displayName: 'Student (Auth Disabled)',
  role: 'STUDENT',
  locale: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
  accessibilityProfile: {
    mobility: 'NONE',
    stepFree: false,
    requireVerifiedRamps: false,
    maxSlopePercent: null,
    minPassageWidthCm: null,
    avoidClosedPassages: false,
    audioGuidance: false,
    shorelineHints: false,
    captions: false,
    textToSpeech: false,
    highContrast: false,
    reducedMotion: false,
    textScale: 1,
    updatedAt: null,
  },
};

type AuthValue = {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  isAuthDisabled: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, locale: Locale) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setDemoUser: (user: Partial<User>) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  // Auth disabled by default: app starts immediately authenticated
  const [user, setUser] = useState<User>(DEFAULT_DEMO_USER);
  const [status, setStatus] = useState<AuthValue['status']>('authenticated');
  const isAuthDisabled = true;

  const refreshUser = useCallback(async () => {
    try {
      const me = await authApi.currentUser();
      if (me) {
        setUser(me);
        setStatus('authenticated');
      }
    } catch {
      // Keep demo user active so all features remain accessible
      setStatus('authenticated');
    }
  }, []);

  useEffect(() => {
    // Attempt silent sync with backend if running, but never block user
    refreshUser();
  }, [refreshUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const next = await authApi.login(email, password);
      setUser(next);
      setStatus('authenticated');
    } catch {
      // In offline/demo mode, set a matching demo user
      const role = email.includes('admin') ? 'ADMIN' : email.includes('benali') ? 'TEACHER' : 'STUDENT';
      const demo: User = {
        ...DEFAULT_DEMO_USER,
        id: `demo-${Date.now()}`,
        email,
        displayName: email.split('@')[0],
        role: role as User['role'],
      };
      setUser(demo);
      setStatus('authenticated');
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string, locale: Locale) => {
    try {
      const next = await authApi.register(name, email, password, locale);
      setUser(next);
      setStatus('authenticated');
    } catch {
      const demo: User = {
        ...DEFAULT_DEMO_USER,
        displayName: name,
        email,
        locale,
      };
      setUser(demo);
      setStatus('authenticated');
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // In auth-disabled mode, signing out resets to guest demo user rather than locking the app
      setUser(DEFAULT_DEMO_USER);
      setStatus('authenticated');
    }
  }, []);

  const setDemoUser = useCallback((patch: Partial<User>) => {
    setUser(prev => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ user, status, isAuthDisabled, signIn, register, signOut, refreshUser, setDemoUser }),
    [user, status, isAuthDisabled, signIn, register, signOut, refreshUser, setDemoUser]
  );

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
