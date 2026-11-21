/**
 * UI preferences, persisted locally (and synced with the server accessibility
 * profile when signed in). Applied to <html>: data-theme, data-motion, lang,
 * dir and the root font size (text scaling up to 200 %).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeChoice = 'warm' | 'system' | 'light' | 'dark' | 'hc';
export type MotionChoice = 'system' | 'reduce' | 'full';
export type Lang = 'ar' | 'fr' | 'en';

export const LANGS: readonly Lang[] = ['ar', 'fr', 'en'];
export const RTL_LANGS: readonly Lang[] = ['ar'];
export const TEXT_SCALE = { min: 1, max: 2, step: 0.25 } as const;

type PreferencesState = {
  theme: ThemeChoice;
  motion: MotionChoice;
  textScale: number;
  lang: Lang | null;
  sidebarCollapsed: boolean;
  floorId: string | null;
  setTheme: (theme: ThemeChoice) => void;
  setMotion: (motion: MotionChoice) => void;
  setTextScale: (scale: number) => void;
  setLang: (lang: Lang) => void;
  toggleSidebar: () => void;
  setFloorId: (floorId: string | null) => void;
};

const clampScale = (s: number): number => Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, Math.round(s * 100) / 100));

/** localStorage can throw (private mode, blocked storage): fall back to memory. */
const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__cw__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) };
  }
});

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'light',
      motion: 'system',
      textScale: 1,
      lang: null,
      sidebarCollapsed: false,
      floorId: null,
      setTheme: (theme) => set({ theme }),
      setMotion: (motion) => set({ motion }),
      setTextScale: (scale) => set({ textScale: clampScale(scale) }),
      setLang: (lang) => set({ lang }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setFloorId: (floorId) => set({ floorId }),
    }),
    { name: 'campusway.preferences', storage: safeStorage, version: 1 },
  ),
);

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean, prefersMoreContrast: boolean): 'warm' | 'light' | 'dark' | 'hc' {
  if (choice !== 'system') return choice;
  if (prefersMoreContrast) return 'hc';
  return prefersDark ? 'dark' : 'warm';
}

export const directionOf = (lang: Lang): 'rtl' | 'ltr' => (RTL_LANGS.includes(lang) ? 'rtl' : 'ltr');

const media = (q: string): MediaQueryList | null => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);

/** Writes the preferences onto <html>. Called on every change and when system settings change. */
export function applyPreferences(state: Pick<PreferencesState, 'theme' | 'motion' | 'textScale'>, lang: Lang, root: HTMLElement = document.documentElement): void {
  const theme = resolveTheme(state.theme, !!media('(prefers-color-scheme: dark)')?.matches, !!media('(prefers-contrast: more)')?.matches);
  root.dataset.theme = theme;
  if (state.motion === 'system') delete root.dataset.motion;
  else root.dataset.motion = state.motion;
  root.style.fontSize = `${Math.round(state.textScale * 100)}%`;
  root.lang = lang;
  root.dir = directionOf(lang);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'warm' || theme === 'light' ? '#476C4C' : theme === 'dark' ? '#1E2E21' : '#000000');
}

/** Keeps <html> in sync with the store and with system settings. Returns an unsubscribe function. */
export function watchSystemPreferences(onChange: () => void): () => void {
  const queries = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(prefers-reduced-motion: reduce)'].map(media).filter((q): q is MediaQueryList => !!q);
  queries.forEach((q) => q.addEventListener('change', onChange));
  return () => queries.forEach((q) => q.removeEventListener('change', onChange));
}
