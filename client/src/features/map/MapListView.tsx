/**
 * The same information as the plan, as lists: the map is never the only way to
 * get it. One roving focus group: ↑ / ↓ move between items, Home / End jump.
 */
import { Ban, DoorOpen } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CampusOverview, FloorPlan } from '@/api/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { statusLine } from '@/features/rooms/roomModel';
import { cn } from '@/lib/cn';
import type { MapLayer } from '@/stores/mapPrefs';
import type { Lang } from '@/stores/preferences';
import type { MapItem } from './FloorMap';
import { poiStyle } from './icons';

type Props = {
  scope: 'floor' | 'campus';
  plan: FloorPlan | undefined;
  overview: CampusOverview | undefined;
  layers: Record<MapLayer, boolean>;
  selected: MapItem | null;
  onSelect: (item: MapItem) => void;
};

function onRovingKeys(e: KeyboardEvent<HTMLDivElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-roving]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  let next = -1;
  if (e.key === 'ArrowDown') next = Math.min(items.length - 1, i + 1);
  else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next < 0) return;
  e.preventDefault();
  items[next]?.focus();
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-h3 text-ink">
        {title}
      </h2>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card">{children}</ul>
    </section>
  );
}

const row = 'flex min-h-14 w-full flex-wrap items-center gap-3 px-4 py-2 text-start hover:bg-surface-2';

export function MapListView({ scope, plan, overview, layers, selected, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const local = (name: string, nameAr: string | null) => (lang === 'ar' && nameAr ? nameAr : name);

  const rooms = scope === 'floor' && layers.classrooms ? (plan?.layers.rooms?.features ?? []) : [];
  const poiFeatures =
    scope === 'floor'
      ? (['entrances', 'elevators', 'stairs', 'ramps', 'toilets', 'accessible_toilets', 'facilities'] as const).flatMap((l) => plan?.layers[l]?.features ?? [])
      : overview
        ? [...overview.outdoor.entrances.features, ...overview.outdoor.ramps.features, ...overview.outdoor.facilities.features]
        : [];
  const pois = poiFeatures.filter((f) => layers[poiStyle(f.properties.type).layer]);
  const closed = layers.closed ? (scope === 'floor' ? (plan?.layers.passages?.features ?? []) : (overview?.outdoor.passages.features ?? [])).filter((f) => !f.properties.isOpen) : [];
  const isSel = (kind: MapItem['kind'], id: string) => selected?.kind === kind && selected.id === id;

  return (
    // The group handles arrow keys for the buttons inside it.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onKeyDown={onRovingKeys} className="flex flex-col gap-6 p-4">
      {scope === 'campus' && overview ? (
        <Section id="list-buildings" title={t('palette.buildings')}>
          {overview.buildings.map((b) => (
            <li key={b.id}>
              <button type="button" data-roving className={row} aria-pressed={isSel('building', b.id)} onClick={() => onSelect({ kind: 'building', id: b.id })}>
                <span className="text-base font-bold text-ink">{local(b.name, b.nameAr)}</span>
                <span className="text-sm text-muted">{t('palette.floorsCount', { count: b.floors.length })}</span>
              </button>
            </li>
          ))}
        </Section>
      ) : null}

      {rooms.length ? (
        <Section id="list-rooms" title={t('map.rooms')}>
          {rooms.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                data-roving
                aria-pressed={isSel('room', f.id)}
                className={cn(row, isSel('room', f.id) && 'bg-primary-50')}
                onClick={() => onSelect({ kind: 'room', id: f.id })}
              >
                <DoorOpen aria-hidden className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-ink">{f.properties.code}</span>
                  <span className="block text-sm text-muted">{`${local(f.properties.name, f.properties.nameAr)} · ${t(`roomType.${f.properties.type}`)}`}</span>
                </span>
                {layers.status ? (
                  <span className="flex flex-col items-end gap-1">
                    <StatusBadge status={f.properties.status.status} label={f.properties.status.label} size="sm" />
                    <span className="text-sm text-muted">{statusLine(f.properties.status, t, lang).split(' · ').slice(1).join(' · ')}</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </Section>
      ) : null}

      {pois.length ? (
        <Section id="list-places" title={t('map.places')}>
          {pois.map((f) => {
            const Icon = poiStyle(f.properties.type).icon;
            return (
              <li key={f.id}>
                <button type="button" data-roving aria-pressed={isSel('poi', f.id)} className={cn(row, isSel('poi', f.id) && 'bg-primary-50')} onClick={() => onSelect({ kind: 'poi', id: f.id })}>
                  <Icon aria-hidden className="size-5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-ink">{local(f.properties.name, f.properties.nameAr)}</span>
                    <span className="block text-sm text-muted">{t(`poiType.${f.properties.type}`)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </Section>
      ) : null}

      {closed.length ? (
        <Section id="list-closed" title={t('map.closedPassages')}>
          {closed.map((f) => (
            <li key={f.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <Ban aria-hidden className="size-5 shrink-0 text-danger" />
              <span className="text-base text-ink">{t('map.closedReason', { reason: f.properties.closedReason ?? '—' })}</span>
            </li>
          ))}
        </Section>
      ) : null}

      {!rooms.length && !pois.length && !closed.length && scope === 'floor' ? <p className="text-base text-muted">{t('map.empty')}</p> : null}
    </div>
  );
}
