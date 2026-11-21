import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { isRtl } from '@/lib/hooks';

export type TabItem<V extends string> = { value: V; label: string; icon?: LucideIcon };

type TabsProps<V extends string> = {
  idBase: string;
  label: string;
  items: readonly TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
};

export const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`;
export const panelId = (idBase: string, value: string) => `${idBase}-panel-${value}`;

/** WAI-ARIA tabs (automatic activation): roving tabindex, arrows (mirrored in RTL), Home / End. */
export function Tabs<V extends string>({ idBase, label, items, value, onChange, className }: TabsProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    let next = -1;
    if (e.key === forward) next = (index + 1) % items.length;
    else if (e.key === backward) next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex flex-wrap gap-1 rounded-control border border-line bg-primary-50 p-1 shadow-card', className)}>
      {items.map((item, i) => {
        const selected = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idBase, item.value)}
            aria-selected={selected}
            aria-controls={panelId(idBase, item.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex min-h-12 items-center gap-2 rounded-control px-4 text-base font-bold transition-colors duration-fast',
              selected ? 'border border-soft bg-card text-primary shadow-card hc:bg-primary hc:text-on-primary' : 'text-muted hover:text-ink',
            )}
          >
            {Icon ? <Icon aria-hidden className="size-5" /> : null}
            {item.label}
            {selected ? <span aria-hidden className="ms-1 h-1.5 w-1.5 rounded-full bg-primary hc:bg-on-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, value, active, children }: { idBase: string; value: string; active: boolean; children: ReactNode }) {
  // APG: a tab panel without focusable content gets tabindex=0 so keyboard users can reach it.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div role="tabpanel" id={panelId(idBase, value)} aria-labelledby={tabId(idBase, value)} hidden={!active} tabIndex={0} className="mt-4">
      {active ? children : null}
    </div>
  );
}
