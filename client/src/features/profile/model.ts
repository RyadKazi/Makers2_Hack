/** Accessibility profile model: needs (multi-select) ↔ the server profile. Pure. */
import type { AccessibilityProfile, MobilityProfile } from '@/api/types';
import type { MotionChoice, ThemeChoice } from '@/stores/preferences';

export type Need = MobilityProfile;
export const NEEDS: readonly Need[] = ['WHEELCHAIR', 'REDUCED_MOBILITY', 'BLIND_LOW_VISION', 'DEAF_HARD_OF_HEARING', 'SPEECH', 'NONE'];

/** The server stores one coarse category (routing defaults); the most constraining need wins. */
const PRIORITY: readonly Need[] = ['WHEELCHAIR', 'REDUCED_MOBILITY', 'BLIND_LOW_VISION', 'DEAF_HARD_OF_HEARING', 'SPEECH'];

export type ProfileDraft = Omit<AccessibilityProfile, 'updatedAt' | 'mobility'>;

export const EMPTY_DRAFT: ProfileDraft = {
  stepFree: false,
  requireVerifiedRamps: false,
  maxSlopePercent: null,
  minPassageWidthCm: null,
  avoidClosedPassages: true,
  audioGuidance: false,
  shorelineHints: false,
  captions: false,
  textToSpeech: false,
  highContrast: false,
  reducedMotion: false,
  textScale: 1,
};

/** "None of these" is exclusive. */
export function toggleNeed(needs: readonly Need[], need: Need): Need[] {
  if (need === 'NONE') return needs.includes('NONE') ? [] : ['NONE'];
  const without = needs.filter((n) => n !== 'NONE');
  return without.includes(need) ? without.filter((n) => n !== need) : [...without, need];
}

export function primaryMobility(needs: readonly Need[]): MobilityProfile {
  return PRIORITY.find((n) => needs.includes(n)) ?? 'NONE';
}

/** Sensible defaults for the selected needs (the user reviews and can change every one). */
export function defaultsFor(needs: readonly Need[], base: ProfileDraft = EMPTY_DRAFT): ProfileDraft {
  const d: ProfileDraft = { ...base };
  if (needs.includes('WHEELCHAIR')) Object.assign(d, { stepFree: true, requireVerifiedRamps: true, maxSlopePercent: 6, minPassageWidthCm: 85 });
  if (needs.includes('REDUCED_MOBILITY')) Object.assign(d, { maxSlopePercent: d.maxSlopePercent ?? 8 });
  if (needs.includes('BLIND_LOW_VISION')) Object.assign(d, { audioGuidance: true, shorelineHints: true });
  if (needs.includes('DEAF_HARD_OF_HEARING')) Object.assign(d, { captions: true });
  if (needs.includes('SPEECH')) Object.assign(d, { textToSpeech: true });
  return d;
}

/** Reconstructs the needs from a saved profile (for editing). */
export function needsFrom(profile: AccessibilityProfile): Need[] {
  if (profile.updatedAt === null) return [];
  const needs = new Set<Need>();
  if (profile.mobility !== 'NONE') needs.add(profile.mobility);
  if (profile.stepFree && profile.minPassageWidthCm) needs.add('WHEELCHAIR');
  if (profile.shorelineHints || profile.audioGuidance) needs.add('BLIND_LOW_VISION');
  if (profile.captions) needs.add('DEAF_HARD_OF_HEARING');
  if (profile.textToSpeech) needs.add('SPEECH');
  return needs.size ? [...needs] : ['NONE'];
}

/** UI preferences that follow from the profile. */
export function uiPreferencesFrom(p: Pick<ProfileDraft, 'highContrast' | 'reducedMotion' | 'textScale'>, current: { theme: ThemeChoice }): { theme: ThemeChoice; motion: MotionChoice; textScale: number } {
  return {
    theme: p.highContrast ? 'hc' : current.theme === 'hc' ? 'system' : current.theme,
    motion: p.reducedMotion ? 'reduce' : 'system',
    textScale: p.textScale,
  };
}
