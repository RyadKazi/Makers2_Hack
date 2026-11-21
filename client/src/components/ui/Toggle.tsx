import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useIds } from '@/lib/hooks';

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** Switch row: the whole row is the 48 px target; state also written as text (On / Off). */
export function Toggle({ checked, onChange, label, hint, disabled, className }: ToggleProps) {
  const { t } = useTranslation();
  const ids = useIds('label', 'hint');
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={ids.label}
      aria-describedby={hint ? ids.hint : undefined}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onChange(!checked)}
      className={cn('flex min-h-12 w-full items-center gap-4 rounded-control px-3 py-2 text-start hover:bg-surface-2', disabled && 'cursor-not-allowed opacity-50', className)}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={ids.label} className="text-base font-bold text-ink">
          {label}
        </span>
        {hint ? (
          <span id={ids.hint} className="text-sm text-muted">
            {hint}
          </span>
        ) : null}
      </span>
      <span aria-hidden className="text-sm font-bold text-muted">
        {checked ? t('common.on') : t('common.off')}
      </span>
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-8 w-[3.25rem] shrink-0 items-center rounded-full transition-colors duration-fast',
          checked ? 'bg-primary' : 'bg-line hc:border-2 hc:border-white hc:bg-black',
        )}
      >
        <span
          className={cn(
            'absolute size-6 rounded-full bg-white shadow transition-transform duration-fast hc:bg-white',
            checked ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1',
            checked && 'hc:bg-black',
          )}
          style={{ insetInlineStart: 0 }}
        />
      </span>
    </button>
  );
}
