import { useEffect, useId, useState } from 'react';
import { usePreferences } from '@/stores/preferences';

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Layout tiers from DESIGN_REFERENCE §3. */
export type Tier = 'mobile' | 'tablet' | 'desktop';
export function tierFor(viewportPx: number, textScale: number): Tier {
  const effective = viewportPx / Math.max(1, textScale);
  return effective >= 1200 ? 'desktop' : effective >= 768 ? 'tablet' : 'mobile';
}

/**
 * Layout tier from the EFFECTIVE width (viewport ÷ text scale), so 200 % text
 * reflows to the tablet / mobile layout exactly like 200 % browser zoom would.
 */
export function useTier(): Tier {
  const textScale = usePreferences((s) => s.textScale);
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return tierFor(width, textScale);
}

/** Stable ids for label / description wiring. */
export function useIds<const K extends readonly string[]>(...names: K): Record<K[number], string> {
  const base = useId().replace(/:/g, '');
  return Object.fromEntries(names.map((n) => [n, `${base}-${n}`])) as Record<K[number], string>;
}

export const isRtl = (): boolean => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
