/**
 * Privacy rules for crowdsourced mobility data (Algerian Law 18-07).
 * Every limit lives here so it can be reviewed in one place.
 */
import type { MobilityProfile } from '@prisma/client';
import { env } from '../../config/env.js';
import type { Lang } from '../../lib/i18n.js';

/** Fewer distinct daily pseudonyms than this → never stored, never returned. */
export const K_MIN = 5;
/** Points less accurate than this are dropped. */
export const MAX_ACCURACY_M = 10;
/** A session stops by itself after this long. */
export const SESSION_MAX_MS = 3 * 3_600_000;
/** The status endpoint starts reminding the user this long before an automatic stop. */
export const REMINDER_BEFORE_MS = 15 * 60_000;
/** Raw points, events, sessions and pseudonym salts are deleted after this many days. */
export const RAW_RETENTION_DAYS = 30;
/** Heatmap grid. */
export const CELL_SIZE_M = 2;
export const MAX_BATCH = 100;

export const POLICY_VERSION = env.MOBILITY_POLICY_VERSION;

/** Coarse self-declared needs category: the only attribute stored with a session. */
export type NeedsCategory = MobilityProfile;
export const DISABILITY_CATEGORIES: readonly NeedsCategory[] = ['WHEELCHAIR', 'REDUCED_MOBILITY', 'BLIND_LOW_VISION', 'DEAF_HARD_OF_HEARING', 'SPEECH'];
/** Heatmap segments: everyone, every disability, then each category. */
export const SEGMENTS = ['ALL', 'DISABILITY', 'NONE', ...DISABILITY_CATEGORIES] as const;
export type Segment = (typeof SEGMENTS)[number];

export const POLICY_SUMMARY: Record<Lang, string[]> = {
  fr: [
    'Le partage est facultatif et vous pouvez l’arrêter à tout moment.',
    'Seuls vos déplacements dans l’enceinte du campus sont enregistrés, avec un pseudonyme qui change chaque jour : jamais votre nom.',
    'L’enregistrement s’arrête seul quand vous quittez le campus, après 3 heures et à minuit.',
    'Seule une catégorie de besoins (par ex. fauteuil roulant) est conservée avec le trajet.',
    'Les points bruts sont supprimés après 30 jours. L’administration ne voit que des statistiques regroupant au moins 5 personnes.',
    'En retirant votre consentement, vous pouvez faire supprimer vos données encore conservées.',
  ],
  en: [
    'Sharing is optional and you can stop it at any time.',
    'Only your movements inside the campus are recorded, under a pseudonym that changes every day — never your name.',
    'Recording stops by itself when you leave campus, after 3 hours and at midnight.',
    'Only a coarse needs category (e.g. wheelchair) is kept with a trip.',
    'Raw points are deleted after 30 days. The administration only sees statistics grouping at least 5 people.',
    'When you withdraw consent you can have your remaining data deleted.',
  ],
  ar: [
    'المشاركة اختيارية ويمكنك إيقافها في أي وقت.',
    'لا تُسجَّل إلا تنقلاتك داخل الحرم الجامعي، باسم مستعار يتغير كل يوم، وليس باسمك أبدًا.',
    'يتوقف التسجيل تلقائيًا عند مغادرة الحرم، وبعد 3 ساعات، وعند منتصف الليل.',
    'لا تُحفظ مع المسار إلا فئة احتياجات عامة (مثل الكرسي المتحرك).',
    'تُحذف النقاط الخام بعد 30 يومًا. ولا ترى الإدارة إلا إحصاءات تجمع 5 أشخاص على الأقل.',
    'عند سحب موافقتك يمكنك طلب حذف بياناتك المتبقية.',
  ],
};

/** Removes things that look like contact details from free-text notes. */
export function redactNote(note: string): string {
  return note
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[…]')
    .replace(/(\+?\d[\d\s.-]{7,}\d)/g, '[…]')
    .trim()
    .slice(0, 280);
}
