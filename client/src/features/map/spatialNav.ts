/**
 * Spatial keyboard navigation between map items. Pure.
 * Arrow keys follow the SCREEN (north up, east right) in every language:
 * a direction on a plan is physical, so it is not mirrored in RTL.
 */
export type Dir = 'up' | 'down' | 'left' | 'right';
export type NavPoint = { id: string; x: number; y: number };

const VECTORS: Record<Dir, [number, number]> = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };

export function keyToDir(key: string): Dir | null {
  return ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[key as 'ArrowUp'] ?? null;
}

/**
 * Nearest item in a ±60° cone around the direction; distance along the direction
 * counts once, sideways offset twice (prefers items "straight ahead").
 */
export function nextInDirection(from: NavPoint, items: readonly NavPoint[], dir: Dir): string | null {
  const [vx, vy] = VECTORS[dir];
  let best: { id: string; cost: number } | null = null;
  for (const p of items) {
    if (p.id === from.id) continue;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const along = dx * vx + dy * vy;
    if (along <= 0.01) continue;
    const across = Math.abs(dx * vy - dy * vx);
    if (across > along * Math.tan(Math.PI / 3)) continue; // outside the 60° cone
    const cost = along + 2 * across;
    if (!best || cost < best.cost) best = { id: p.id, cost };
  }
  return best?.id ?? null;
}

/** Reading order for Tab: rows from north to south, then west to east (east to west in RTL). */
export function readingOrder<T extends NavPoint>(items: readonly T[], rtl: boolean, rowHeight = 6): T[] {
  return [...items].sort((a, b) => {
    const rowA = Math.round(-a.y / rowHeight);
    const rowB = Math.round(-b.y / rowHeight);
    if (rowA !== rowB) return rowA - rowB;
    return rtl ? b.x - a.x : a.x - b.x;
  });
}
