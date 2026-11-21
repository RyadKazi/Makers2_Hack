import { AlertCircle, type LucideIcon } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useIds } from '@/lib/hooks';

type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  icon?: LucideIcon;
  /** Element rendered inside the field at the end (e.g. a show-password IconButton). */
  end?: ReactNode;
};

function describedBy(ids: { hint: string; error: string }, hint: unknown, error: unknown, extra?: string): string | undefined {
  return [extra, hint ? ids.hint : null, error ? ids.error : null].filter(Boolean).join(' ') || undefined;
}

function FieldText({ ids, hint, error }: { ids: { hint: string; error: string }; hint?: ReactNode; error?: ReactNode }) {
  return (
    <>
      {hint ? (
        <p id={ids.hint} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={ids.error} className="flex items-start gap-2 text-sm font-bold text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldProps;

/** Text field: visible label above, hint and error linked with aria-describedby. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, hideLabel, icon: Icon, end, className, id, 'aria-describedby': extraDescribedBy, ...rest },
  ref,
) {
  const ids = useIds('input', 'hint', 'error');
  const inputId = id ?? ids.input;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className={cn('text-sm font-bold text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative rounded-control shadow-card">
        {Icon ? <Icon aria-hidden className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted" /> : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, hint, error, extraDescribedBy)}
          className={cn(
            'min-h-12 w-full rounded-control bg-card text-base text-ink placeholder:text-muted',
            Icon ? 'ps-12' : 'ps-4',
            end ? 'pe-14' : 'pe-4',
            error ? 'border-2 border-danger' : 'border-control',
          )}
          {...rest}
        />
        {end ? <div className="absolute end-0 top-1/2 -translate-y-1/2">{end}</div> : null}
      </div>
      <FieldText ids={ids} hint={hint} error={error} />
    </div>
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { pill?: boolean };

/** Native select (best screen-reader and mobile support), styled to the design. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, hideLabel, icon: Icon, pill, className, id, children, ...rest },
  ref,
) {
  const ids = useIds('select', 'hint', 'error');
  const selectId = id ?? ids.select;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className={cn('text-sm font-bold text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative rounded-control shadow-card">
        {Icon ? <Icon aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" /> : null}
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, hint, error)}
          className={cn(
            'min-h-12 w-full cursor-pointer appearance-none bg-card pe-10 text-base text-ink',
            pill ? 'rounded-full' : 'rounded-control',
            Icon ? 'ps-11' : 'ps-4',
            error ? 'border-2 border-danger' : 'border-control',
          )}
          {...rest}
        >
          {children}
        </select>
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute end-3.5 top-1/2 size-5 -translate-y-1/2 text-muted">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <FieldText ids={ids} hint={hint} error={error} />
    </div>
  );
});
