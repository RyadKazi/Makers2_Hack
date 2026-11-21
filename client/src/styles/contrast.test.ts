/**
 * Checks the token pairs we use for text and UI, in all three themes, straight
 * from tokens.css (the single source of truth). WCAG 2.2: 4.5:1 for text,
 * 3:1 for UI components, borders of controls and focus indicators.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseChannels, type Rgb } from '@/lib/contrast';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

function theme(selector: string): Record<string, Rgb> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, Rgb> = {};
  for (const m of block.matchAll(/--c-([\w-]+):\s*([\d\s]+);/g)) out[m[1]!] = parseChannels(m[2]!);
  return out;
}

const THEMES = { light: theme("[data-theme='light']"), dark: theme("[data-theme='dark']"), hc: theme("[data-theme='hc']") };

const TEXT: [string, string][] = [
  ['ink', 'canvas'],
  ['ink', 'card'],
  ['ink', 'surface-2'],
  ['muted', 'card'],
  ['muted', 'canvas'],
  ['muted', 'surface-2'],
  ['on-primary', 'primary'],
  ['ink', 'primary-50'],
  ['route-text', 'card'],
  ['route-text', 'route-100'],
  ['available', 'available-bg'],
  ['occupied', 'occupied-bg'],
  ['club', 'club-bg'],
  ['warning', 'warning-bg'],
  ['occupied', 'card'], // danger text on cards
];

const NON_TEXT: [string, string][] = [
  ['line-strong', 'card'], // control borders
  ['focus', 'card'],
  ['focus', 'canvas'],
  ['primary', 'canvas'],
  ['primary', 'card'], // exact brand green is reserved for interactive/UI accents
  ['route', 'canvas'], // route line on the map canvas
  ['route', 'card'],
];

describe.each(Object.entries(THEMES))('%s theme', (_name, t) => {
  it('defines every token', () => {
    expect(Object.keys(t).sort()).toEqual(Object.keys(THEMES.light).sort());
  });

  it.each(TEXT)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrastRatio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)('UI %s on %s ≥ 3:1', (fg, bg) => {
    expect(contrastRatio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

describe('spec tokens', () => {
  it('uses the source forest / cream palette with an AA-safe dark palette', () => {
    expect(THEMES.light.canvas).toEqual([248, 250, 247]);
    expect(THEMES.light.ink).toEqual([38, 55, 42]);
    expect(THEMES.light.primary).toEqual([71, 108, 76]);
    expect(THEMES.light.route).toEqual([71, 108, 76]);
    expect(THEMES.dark.canvas).toEqual([30, 46, 33]);
    expect(THEMES.dark.primary).toEqual([164, 198, 164]);
    expect(THEMES.hc.focus).toEqual([255, 214, 10]);
  });
});
