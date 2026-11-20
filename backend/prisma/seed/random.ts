/** Small deterministic PRNG (mulberry32) so the seed is reproducible. */
export type Rng = {
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  range(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  gaussian(sigma?: number): number;
};

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() on empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weighted: (items) => {
      const total = items.reduce((sum, [, w]) => sum + w, 0);
      let r = next() * total;
      for (const [item, w] of items) {
        r -= w;
        if (r <= 0) return item;
      }
      return items[items.length - 1]![0];
    },
    gaussian: (sigma = 1) => {
      // Box–Muller
      const u = Math.max(next(), 1e-12);
      const v = next();
      return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return rng;
}
