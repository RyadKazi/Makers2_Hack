import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useIds } from '@/lib/hooks';

export type RadioOption<V extends string> = { value: V; label: string; icon?: LucideIcon };

/**
 * Segmented choice built on native radios: arrow keys, form semantics and
 * screen-reader support come for free. Selected = fill + dot + bold (not colour only).
 */
export function RadioGroup<V extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  hint,
  className,
}: {
  legend: ReactNode;
  name: string;
  options: readonly RadioOption<V>[];
  value: V;
  onChange: (value: V) => void;
  hint?: ReactNode;
  className?: string;
}) {
  const ids = useIds('hint');
  return (
    <fieldset className={cn('flex flex-col gap-2', className)} aria-describedby={hint ? ids.hint : undefined}>
      <legend className="mb-2 text-base font-bold text-ink">{legend}</legend>
      {hint ? (
        <p id={ids.hint} className="-mt-1 mb-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {options.map(({ value: v, label, icon: Icon }) => {
          const checked = v === value;
          return (
            <label
              key={v}
              className={cn(
                'relative flex min-h-12 cursor-pointer items-center gap-2 rounded-control px-4 text-base font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                checked ? 'border-2 border-primary bg-primary-50 text-ink hc:bg-primary hc:text-on-primary' : 'border-control bg-card text-ink hover:bg-surface-2',
              )}
            >
              <input type="radio" name={name} value={v} checked={checked} onChange={() => onChange(v)} className="sr-only" />
              <span aria-hidden className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border-2', checked ? 'border-primary hc:border-on-primary' : 'border-line-strong')}>
                {checked ? <span className="size-2.5 rounded-full bg-primary hc:bg-on-primary" /> : null}
              </span>
              {Icon ? <Icon aria-hidden className="size-5" /> : null}
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Native range input with a visible label and the current value as text. */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  hint?: ReactNode;
}) {
  const ids = useIds('input', 'hint', 'out');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={ids.input} className="text-base font-bold text-ink">
          {label}
        </label>
        <output id={ids.out} htmlFor={ids.input} className="text-base font-bold text-primary tabular">
          {format(value)}
        </output>
      </div>
      <input
        id={ids.input}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        aria-describedby={hint ? ids.hint : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-12 w-full cursor-pointer accent-[rgb(var(--c-primary))]"
      />
      {hint ? (
        <p id={ids.hint} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
