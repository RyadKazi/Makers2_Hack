import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGS, usePreferences, type Lang } from '@/stores/preferences';
import ar from './locales/ar';
import en from './locales/en';
import fr from './locales/fr';

export const LANGUAGE_NAMES: Record<Lang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };

/** Saved choice → browser languages → French (default of the campus). */
export function initialLanguage(): Lang {
  const saved = usePreferences.getState().lang;
  if (saved) return saved;
  const candidates = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const c of candidates) {
    const code = c.slice(0, 2).toLowerCase() as Lang;
    if (LANGS.includes(code)) return code;
  }
  return 'fr';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr }, ar: { translation: ar } },
  lng: initialLanguage(),
  fallbackLng: 'fr',
  supportedLngs: [...LANGS],
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
});

export function currentLang(): Lang {
  return (LANGS.includes(i18n.language as Lang) ? i18n.language : 'fr') as Lang;
}

export default i18n;
