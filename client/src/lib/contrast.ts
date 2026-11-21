/** WCAG 2.x contrast ratio helpers. */
export type Rgb = [number, number, number];

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Parses "37 71 208" (our CSS variable format). */
export function parseChannels(value: string): Rgb {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) throw new Error(`Bad colour channels: "${value}"`);
  return parts as Rgb;
}

export const toHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Reads a token of the active theme, e.g. tokenRgb('primary'). */
export function tokenRgb(name: string, el: Element = document.documentElement): Rgb {
  return parseChannels(getComputedStyle(el).getPropertyValue(`--c-${name}`));
}
