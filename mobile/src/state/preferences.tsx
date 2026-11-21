import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/types/api';
import { messages, type TranslationKey } from '@/i18n/messages';
import {
  type ThemeMode,
  type ThemeColors,
  lightColors,
  warmColors,
  darkColors,
  hcColors,
  radii,
  spacing,
  shadows,
  typography,
} from '@/theme/theme';

export type { ThemeMode, ThemeColors };
export { radii, spacing, shadows, typography };

export type Palette = ThemeColors;

export type Preferences = {
  locale: Locale;
  theme: ThemeMode;
  highContrast: boolean;
  textScale: number;
  reducedMotion: boolean;
};

const PREF_KEY = 'campusway.preferences';
const LEGACY_PREF_KEY = 'accesu.preferences';

const defaults: Preferences = {
  locale: 'en',
  theme: 'warm', // Authoritative branded default from web
  highContrast: false,
  textScale: 1,
  reducedMotion: false,
};

type PreferencesValue = {
  preferences: Preferences;
  ready: boolean;
  palette: ThemeColors;
  isRTL: boolean;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>;
  t: (key: TranslationKey) => string;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: React.PropsWithChildren) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const systemColor = useColorScheme();

  useEffect(() => {
    (async () => {
      try {
        const val = (await AsyncStorage.getItem(PREF_KEY)) || (await AsyncStorage.getItem(LEGACY_PREF_KEY));
        if (val) {
          setPreferences({ ...defaults, ...JSON.parse(val) });
        }
      } catch {
        // Fallback to defaults
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setPreference = useCallback(async <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    const next = { ...preferences, [key]: value } as Preferences;
    setPreferences(next);
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify(next));
  }, [preferences]);

  const palette = useMemo((): ThemeColors => {
    if (preferences.highContrast || preferences.theme === 'hc') {
      return hcColors;
    }
    if (preferences.theme === 'dark') {
      return darkColors;
    }
    if (preferences.theme === 'light') {
      return lightColors;
    }
    if (preferences.theme === 'warm') {
      return warmColors;
    }
    // 'system'
    return systemColor === 'dark' ? darkColors : warmColors;
  }, [preferences.theme, preferences.highContrast, systemColor]);

  const t = useCallback(
    (key: TranslationKey) => (messages[preferences.locale] as Record<TranslationKey, string>)[key] ?? messages.en[key] ?? key,
    [preferences.locale]
  );

  const value = useMemo(
    () => ({
      preferences,
      ready,
      palette,
      isRTL: preferences.locale === 'ar',
      setPreference,
      t,
    }),
    [preferences, ready, palette, setPreference, t]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used within PreferencesProvider');
  return value;
}
