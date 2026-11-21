/**
 * Fuzzy search for AR / FR / EN. Pure.
 * - Latin: case and accents ignored ("bibliotheque" finds "Bibliothèque").
 * - Arabic: diacritics and tatweel removed; أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي;
 *   the article "ال" is optional ("مكتبة" finds "المكتبة").
 * - Codes: separators ignored ("a104" finds "A-104").
 * - Typos: 1 edit for words of 4+ letters, 2 for 8+ (Damerau–Levenshtein).
 * Every query word must match some word of the entry.
 */

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Latin combining accents
    .replace(/[ً-ٰٟـ]/g, '') // Arabic harakat, hamza marks, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Words of a text, plus variants: Arabic without "ال", and the whole text without spaces (codes). */
export function wordsOf(text: string): string[] {
  const norm = normalize(text);
  if (!norm) return [];
  const words = norm.split(' ');
  const out = new Set(words);
  for (const w of words) if (w.startsWith('ال') && w.length > 3) out.add(w.slice(2));
  if (words.length > 1) out.add(words.join(''));
  return [...out];
}

/** Damerau–Levenshtein distance, stopping early above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

const allowedEdits = (len: number): number => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/** How well one query word matches one entry word, 0–1. */
export function wordScore(q: string, w: string): number {
  if (w === q) return 1;
  if (w.startsWith(q)) return 0.9 - Math.min(0.2, (w.length - q.length) * 0.01);
  if (q.length >= 3 && w.includes(q)) return 0.65;
  const max = allowedEdits(q.length);
  if (max > 0) {
    // Whole word, or the start of a longer word being typed.
    const dist = Math.min(editDistance(q, w, max), w.length > q.length ? editDistance(q, w.slice(0, q.length), max) : max + 1);
    if (dist <= max) return 0.6 - dist * 0.1;
  }
  return 0;
}

export type Searchable = { id: string; words: string[] };

export function prepare<T extends { id: string }>(item: T, texts: (string | null | undefined)[]): T & Searchable {
  return { ...item, words: [...new Set(texts.filter((t): t is string => !!t).flatMap(wordsOf))] };
}

/** Returns matching items, best first, with their score. */
export function fuzzySearch<T extends Searchable>(items: readonly T[], query: string, limit = 20): { item: T; score: number }[] {
  const qWords = normalize(query).split(' ').filter(Boolean);
  if (qWords.length === 0) return [];
  const compact = qWords.join('');
  const results: { item: T; score: number }[] = [];
  for (const item of items) {
    let total = 0;
    let ok = true;
    for (const q of qWords) {
      let best = 0;
      for (const w of item.words) best = Math.max(best, wordScore(q, w));
      if (best === 0) {
        ok = false;
        break;
      }
      total += best;
    }
    // A multi-word query may also be a code typed without separators ("a 104" vs "a104").
    if (!ok && qWords.length > 1) {
      const best = Math.max(0, ...item.words.map((w) => wordScore(compact, w)));
      if (best > 0) {
        ok = true;
        total = best * qWords.length;
      }
    }
    if (ok) results.push({ item, score: total / qWords.length });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
