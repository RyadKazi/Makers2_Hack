/** Joins class names, skipping falsy values (false, null, undefined, '', 0). */
export function cn(...parts: (string | number | boolean | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
