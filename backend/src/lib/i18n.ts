import type { Request } from 'express';
import { z } from 'zod';

export const LANGS = ['ar', 'fr', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'fr';

export const LangSchema = z.enum(LANGS).meta({ id: 'Lang', description: 'Interface language' });

/** `?lang=` wins, then the first supported Accept-Language entry, then French. */
export function resolveLang(req: Pick<Request, 'query' | 'headers'>): Lang {
  const fromQuery = typeof req.query.lang === 'string' ? req.query.lang : undefined;
  if (fromQuery && (LANGS as readonly string[]).includes(fromQuery)) return fromQuery as Lang;
  const header = req.headers['accept-language'];
  if (typeof header === 'string') {
    for (const part of header.split(',')) {
      const code = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
      if (code && (LANGS as readonly string[]).includes(code)) return code as Lang;
    }
  }
  return DEFAULT_LANG;
}

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}
