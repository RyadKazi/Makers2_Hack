/** Floor names from the level, in the interface language (stored names are French data). */
type T = (key: string, opts?: Record<string, unknown>) => string;

export function floorLabel(level: number, t: T): string {
  if (level === 0) return t('floorName.ground');
  if (level === 1) return t('floorName.first');
  if (level < 0) return t('floorName.basement', { n: -level });
  return t('floorName.n', { n: level });
}
