/**
 * Locale-aware formatting. Algerian Arabic (ar-DZ) uses Latin digits, and Intl
 * places units correctly in RTL ("90 سم", not "cm 90"). Times are campus time
 * (Africa/Algiers) whatever the device time zone.
 */
import type { Lang } from '@/stores/preferences';

const LOCALE: Record<Lang, string> = { ar: 'ar-DZ', fr: 'fr-DZ', en: 'en-GB' };
export const CAMPUS_TZ = 'Africa/Algiers';

export function formatNumber(value: number, lang: Lang, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE[lang], options).format(value);
}

export function formatUnit(value: number, unit: 'meter' | 'centimeter' | 'percent' | 'minute' | 'second', lang: Lang): string {
  if (unit === 'percent') return formatNumber(value / 100, lang, { style: 'percent', maximumFractionDigits: 0 });
  // Arabic "short" drops the number for 1 and 2 ("متر", "متران"); narrow keeps it ("1 م"), like the server's instructions.
  const display = lang === 'ar' && unit === 'meter' ? 'narrow' : 'short';
  return formatNumber(value, lang, { style: 'unit', unit, unitDisplay: display, maximumFractionDigits: 1 });
}

const dayKey = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_TZ }).format(d);

export function sameCampusDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** "14:00" today; "Thu 08:00" on another day. */
export function formatTime(value: string | Date, lang: Lang, now: Date = new Date()): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const time = new Intl.DateTimeFormat(LOCALE[lang], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: CAMPUS_TZ }).format(d);
  if (sameCampusDay(d, now)) return time;
  const day = new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short', timeZone: CAMPUS_TZ }).format(d);
  return `${day} ${time}`;
}

export function formatTimeRange(start: string, end: string, lang: Lang): string {
  const f = (v: string) => new Intl.DateTimeFormat(LOCALE[lang], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: CAMPUS_TZ }).format(new Date(v));
  return `${f(start)} – ${f(end)}`;
}
