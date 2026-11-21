import { Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet, type Snap } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { STATUS_STYLE } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';
import { MAP_LAYERS, useMapPrefs, type MapLayer } from '@/stores/mapPrefs';

function LayerChecklist() {
  const { t } = useTranslation();
  const { layers, toggleLayer, setAll } = useMapPrefs();
  return (
    <fieldset>
      <legend className="sr-only">{t('map.layersTitle')}</legend>
      <ul className="flex flex-col">
        {MAP_LAYERS.map((l: MapLayer) => (
          <li key={l}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-3 text-base text-ink hover:bg-surface-2">
              <input type="checkbox" checked={layers[l]} onChange={() => toggleLayer(l)} className="size-5 shrink-0 accent-[rgb(var(--c-primary))]" />
              {t(`layer.${l}`)}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2 border-t border-line pt-2">
        <Button variant="ghost" onClick={() => setAll(true)}>
          {t('map.showAll')}
        </Button>
        <Button variant="ghost" onClick={() => setAll(false)}>
          {t('map.hideAll')}
        </Button>
      </div>
    </fieldset>
  );
}

/** "Layers" button: a popover on tablet / desktop, a bottom sheet on phones. */
export function LayersControl({ mobile }: { mobile: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<Snap>('half');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || mobile) return undefined;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLInputElement>('#layers-popover input')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, mobile]);

  return (
    <div ref={root} className="relative">
      <Button ref={button} variant="secondary" icon={Layers} aria-expanded={open} aria-controls={mobile ? undefined : 'layers-popover'} onClick={() => setOpen((o) => !o)}>
        {t('map.layers')}
      </Button>
      {open && !mobile ? (
        <div id="layers-popover" role="group" aria-label={t('map.layersTitle')} className="absolute end-0 top-14 z-overlay w-80 rounded-card border border-line bg-card p-2 shadow-float">
          <LayerChecklist />
        </div>
      ) : null}
      {mobile ? (
        <BottomSheet open={open} modal title={t('map.layersTitle')} snap={snap} onSnapChange={setSnap} onClose={() => setOpen(false)}>
          <LayerChecklist />
        </BottomSheet>
      ) : null}
    </div>
  );
}

/** Legend bar under the plan (image 1): every status with its pattern + icon + label. */
export function MapLegend({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const statuses = [
    { key: 'AVAILABLE', label: t('status.AVAILABLE'), tone: 'text-available', bg: 'bg-available-bg' },
    { key: 'TEACHER', label: t('rooms.statusFilter.occupied'), tone: 'text-occupied', bg: 'bg-occupied-bg' },
    { key: 'CLUB', label: t('rooms.statusFilter.club'), tone: 'text-club', bg: 'bg-club-bg' },
  ] as const;
  const item = compact ? 'flex items-center gap-1.5 text-sm font-bold text-ink' : 'flex min-h-12 items-center gap-2 text-sm font-bold text-ink';
  return (
    <section aria-labelledby="legend-title" className={cn('border border-line bg-card', compact ? 'rounded-control px-2.5 py-1.5 shadow-card' : 'rounded-card px-4 py-2 shadow-card')}>
      <h2 id="legend-title" className="sr-only">
        {t('map.legend')}
      </h2>
      <ul className={cn('flex flex-wrap items-center', compact ? 'gap-x-3 gap-y-1' : 'gap-x-6 gap-y-1')}>
        {statuses.map(({ key, label, tone, bg }) => {
          const s = STATUS_STYLE[key];
          const Icon = s.icon;
          return (
            <li key={key} className={item}>
              <span aria-hidden className={cn('relative inline-flex items-center justify-center overflow-hidden rounded-lg border-2 border-current', compact ? 'size-3.5 rounded-full border' : 'size-7', tone, bg)}>
                <span className={cn('absolute inset-0 opacity-40', s.pattern, key === 'AVAILABLE' && 'opacity-0')} />
                {!compact ? <Icon className="relative size-4" /> : null}
              </span>
              {label}
            </li>
          );
        })}
        {!compact ? <li className={item}>
          <svg aria-hidden viewBox="0 0 28 12" className="h-3 w-7 text-occupied">
            <line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 7" />
          </svg>
          {t('layer.closed')}
        </li> : null}
        {!compact ? <li className={item}>
          <span aria-hidden className="inline-block h-5 w-7 rounded border-2 border-line-strong bg-card" />
          {t('map.corridor')}
        </li> : null}
        {!compact ? <li className={item}>
          <span aria-hidden className="inline-block h-1 w-7 rounded bg-ink" />
          {t('map.wall')}
        </li> : null}
      </ul>
    </section>
  );
}
