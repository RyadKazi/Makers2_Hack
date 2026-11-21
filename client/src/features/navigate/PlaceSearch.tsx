/**
 * Place picker: ARIA 1.2 combobox (input + listbox), fuzzy search in AR / FR / EN
 * over rooms and places from the search index. Arrow keys move, Enter picks, Escape closes.
 */
import { MapPin } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchIndex } from '@/api/hooks';
import type { SearchIndex } from '@/api/types';
import { poiStyle } from '@/features/map/icons';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { useIds } from '@/lib/hooks';
import { fuzzySearch, prepare } from '@/lib/search';
import type { Lang } from '@/stores/preferences';

export type Place =
  | { kind: 'room'; id: string; label: string; level: number; floorId: string | null }
  | { kind: 'poi'; id: string; label: string; level: number; floorId: string | null; x: number; y: number }
  | { kind: 'here'; label: string };

type Entry = { id: string; place: Place; title: string; meta: string; icon: typeof MapPin };

export function usePlaceEntries(index: SearchIndex | undefined): (Entry & { words: string[] })[] {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  return useMemo(() => {
    if (!index) return [];
    const out: (Entry & { words: string[] })[] = [];
    for (const r of index.rooms) {
      const name = lang === 'ar' && r.nameAr ? r.nameAr : r.name;
      const meta = `${t(`roomType.${r.type}`)} · ${floorLabel(r.level, t)}${r.buildingCode ? ` · ${r.buildingCode}` : ''}`;
      out.push(prepare({ id: `room:${r.code}`, place: { kind: 'room', id: r.code, label: `${r.code} · ${name}`, level: r.level, floorId: r.floorId }, title: `${r.code} · ${name}`, meta, icon: MapPin }, [r.code, r.name, r.nameAr, t(`roomType.${r.type}`)]));
    }
    for (const p of index.pois) {
      const name = lang === 'ar' && p.nameAr ? p.nameAr : p.name;
      const meta = `${t(`poiType.${p.type}`)} · ${p.floorId ? floorLabel(p.level, t) : t('guide.outdoors')}${p.buildingCode ? ` · ${p.buildingCode}` : ''}`;
      out.push(prepare({ id: `poi:${p.id}`, place: { kind: 'poi', id: p.id, label: name, level: p.level, floorId: p.floorId, x: p.x, y: p.y }, title: name, meta, icon: poiStyle(p.type).icon }, [p.name, p.nameAr, t(`poiType.${p.type}`)]));
    }
    return out;
  }, [index, lang, t]);
}

export function PlaceSearch({
  label,
  value,
  onChange,
  hint,
  actions,
  autoFocus,
  hideLabel,
  placeholder,
  className,
}: {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  hint?: ReactNode;
  actions?: ReactNode;
  autoFocus?: boolean;
  hideLabel?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const ids = useIds('input', 'list', 'hint', 'label');
  const index = useSearchIndex();
  const entries = usePlaceEntries(index.data);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const text = query ?? value?.label ?? '';
  const results = useMemo(() => (query && query.trim() ? fuzzySearch(entries, query, 8).map((r) => r.item) : []), [entries, query]);
  const expanded = open && results.length > 0;

  const pick = (e: Entry) => {
    onChange(e.place);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className={cn('relative flex flex-col gap-1', className)}>
      <label id={ids.label} htmlFor={ids.input} className={cn('text-sm font-bold text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-control border-control bg-card pe-1 focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus">
        <MapPin aria-hidden className="ms-3 size-5 shrink-0 text-muted" />
        <input
          ref={inputRef}
          id={ids.input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={ids.list}
          aria-activedescendant={expanded ? `${ids.list}-${active}` : undefined}
          aria-describedby={hint ? ids.hint : undefined}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
          placeholder={placeholder ?? t('guide.searchPlaceholder')}
          value={text}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            if (!e.target.value) onChange(null);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && expanded) {
              e.preventDefault();
              const r = results[active];
              if (r) pick(r);
            } else if (e.key === 'Escape') {
              if (open) e.preventDefault();
              setOpen(false);
              setQuery(null);
            }
          }}
        />
        {actions}
      </div>
      {hint ? (
        <p id={ids.hint} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {query && query.trim() && results.length === 0 && open && index.data ? (
        <p role="status" className="text-sm text-muted">
          {t('guide.noResults', { q: query })}
        </p>
      ) : null}
      <div
        id={ids.list}
        role="listbox"
        aria-labelledby={ids.label}
        className={cn('absolute inset-x-0 top-full z-overlay mt-1 max-h-80 overflow-y-auto rounded-card border border-line bg-card p-1 shadow-float', !expanded && 'hidden')}
      >
        {results.map((r, i) => {
          const Icon = r.icon;
          return (
            // Options are picked with the mouse here; keyboard users use the combobox keys.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <div
              key={r.id}
              id={`${ids.list}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              className={cn('flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-3 py-2', i === active ? 'bg-primary-50 text-ink hc:bg-primary hc:text-on-primary' : 'text-ink hover:bg-surface-2')}
            >
              <Icon aria-hidden className="size-5 shrink-0 text-primary hc:text-current" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-base font-bold">{r.title}</span>
                <span className="truncate text-sm text-muted hc:text-current">{r.meta}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
