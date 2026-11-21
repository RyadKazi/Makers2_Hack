/**
 * Ctrl+K search over rooms, buildings, places (POIs), clubs and pages, with fuzzy
 * matching in Arabic, French and English (accents, Arabic letter variants, typos).
 * WAI-ARIA combobox + listbox: arrows move the active option, Enter opens it.
 */
import { Building2, DoorOpen, Search, Users } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useRooms, useSearchIndex } from '@/api/hooks';
import type { RoomStatus } from '@/api/types';
import { Dialog } from '@/components/ui/Dialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { poiStyle } from '@/features/map/icons';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { fuzzySearch, prepare, type Searchable } from '@/lib/search';
import type { Lang } from '@/stores/preferences';
import { PERSONAL, PRIMARY } from './nav';

type Group = 'rooms' | 'buildings' | 'places' | 'clubs' | 'pages';
type Entry = Searchable & { group: Group; label: string; detail?: string; to: string; icon: typeof Search; roomCode?: string };

const GROUP_ORDER: readonly Group[] = ['rooms', 'buildings', 'places', 'clubs', 'pages'];
const LANGS = ['fr', 'en', 'ar'] as const;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const index = useSearchIndex(open);
  const statuses = useRooms({}, open);

  /** Every entry carries its words in the three languages, so any language finds it. */
  const entries = useMemo<Entry[]>(() => {
    const all = (key: string, opts?: Record<string, unknown>) => LANGS.map((l) => i18n.getFixedT(l)(key, opts));
    const local = (name: string, nameAr: string | null | undefined) => (lang === 'ar' && nameAr ? nameAr : name);
    const out: Entry[] = [];
    const d = index.data;
    if (d) {
      for (const r of d.rooms) {
        out.push(
          prepare({ id: `room:${r.id}`, group: 'rooms' as const, label: `${r.code} · ${local(r.name, r.nameAr)}`, to: `/map?room=${encodeURIComponent(r.code)}`, icon: DoorOpen, roomCode: r.code }, [
            r.code,
            r.name,
            r.nameAr,
            ...all(`roomType.${r.type}`),
          ]),
        );
      }
      for (const b of d.buildings) {
        out.push(
          prepare(
            { id: `building:${b.id}`, group: 'buildings' as const, label: local(b.name, b.nameAr), detail: t('palette.floorsCount', { count: b.floors.length }), to: `/map?building=${b.code}`, icon: Building2 },
            [b.name, b.nameAr, `building ${b.code}`, `bâtiment ${b.code}`, ...all('map.building')],
          ),
        );
      }
      for (const p of d.pois) {
        out.push(
          prepare({ id: `poi:${p.id}`, group: 'places' as const, label: local(p.name, p.nameAr), detail: t(`poiType.${p.type}`), to: `/map?poi=${p.id}`, icon: poiStyle(p.type).icon }, [
            p.name,
            p.nameAr,
            ...all(`poiType.${p.type}`),
          ]),
        );
      }
      for (const c of d.clubs) {
        out.push(
          prepare(
            { id: `club:${c.name}`, group: 'clubs' as const, label: c.name, detail: t('palette.nextSession', { room: c.roomCode, time: formatTime(c.startsAt, lang) }), to: `/map?room=${encodeURIComponent(c.roomCode)}`, icon: Users },
            [c.name, c.title, 'club', 'نادي'],
          ),
        );
      }
    }
    for (const p of [...PRIMARY, ...PERSONAL]) {
      out.push(prepare({ id: `page:${p.to}`, group: 'pages' as const, label: t(p.labelKey), to: p.to, icon: p.icon }, all(p.labelKey)));
    }
    return out;
  }, [index.data, i18n, lang, t]);

  const statusByCode = useMemo(() => new Map<string, RoomStatus>((statuses.data?.items ?? []).map((r) => [r.code, r.status])), [statuses.data]);

  const options = useMemo(() => {
    const q = query.trim();
    const found = q ? fuzzySearch(entries, q, 30).map((r) => r.item) : entries.filter((e) => e.group === 'pages');
    // Relevance order inside each group, groups in a fixed order.
    return GROUP_ORDER.flatMap((g) => found.filter((e) => e.group === g).slice(0, g === 'rooms' ? 8 : 5));
  }, [entries, query]);

  const close = () => {
    setQuery('');
    setActive(0);
    onClose();
  };
  const go = (o: Entry | undefined) => {
    if (!o) return;
    close();
    navigate(o.to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter') go(options[active]);
    else return;
    e.preventDefault();
  };

  const activeId = options[active] ? `cmd-${options[active]!.id}` : undefined;
  const groupTitle: Record<Group, string> = { rooms: t('search.rooms'), buildings: t('palette.buildings'), places: t('palette.places'), clubs: t('palette.clubs'), pages: t('search.pages') };

  return (
    <Dialog open={open} onClose={close} title={t('search.title')} initialFocus={input} placement="top" size="lg">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <input
          ref={input}
          role="combobox"
          aria-label={t('search.label')}
          aria-expanded={options.length > 0}
          aria-controls="cmd-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-describedby="cmd-hint"
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-14 w-full rounded-card border border-line bg-surface-2 pe-4 ps-12 text-lg text-ink placeholder:text-muted focus:bg-card focus:border-primary shadow-card transition-all"
        />
      </div>
      <p id="cmd-hint" className="mt-2 text-sm text-muted">
        {t('search.hint')}
      </p>
      <p className="sr-only" aria-live="polite">
        {query.trim() ? (options.length ? t('search.results', { count: options.length }) : t('search.empty', { query })) : ''}
      </p>
      <div id="cmd-list" role="listbox" aria-label={t('search.title')} className="mt-3 flex flex-col gap-1">
        {GROUP_ORDER.map((g) => {
          const items = options.filter((o) => o.group === g);
          if (!items.length) return null;
          return (
            <div key={g} role="group" aria-labelledby={`cmd-group-${g}`}>
              <div id={`cmd-group-${g}`} role="presentation" className="px-3 pb-1 pt-3 text-sm font-bold text-muted">
                {groupTitle[g]}
              </div>
              {items.map((o) => {
                const i = options.indexOf(o);
                const Icon = o.icon;
                const status = o.roomCode ? statusByCode.get(o.roomCode) : undefined;
                return (
                  // Keyboard is handled by the combobox input (aria-activedescendant pattern).
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- input handles keys
                  <div
                    key={o.id}
                    id={`cmd-${o.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(o)}
                    className={cn('flex min-h-12 cursor-pointer flex-wrap items-center gap-3 rounded-card px-3.5 py-1.5 text-base transition-colors duration-150', i === active ? 'bg-primary-50 text-ink outline outline-2 outline-primary font-bold' : 'text-ink hover:bg-surface-2')}
                  >
                    <Icon aria-hidden className="size-5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.detail ? <span className="block text-sm text-muted">{o.detail}</span> : null}
                    </span>
                    {status ? <StatusBadge status={status.status} label={status.label} size="sm" /> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {query.trim() && options.length === 0 ? <p className="py-6 text-center text-base text-muted">{t('search.empty', { query })}</p> : null}
    </Dialog>
  );
}
