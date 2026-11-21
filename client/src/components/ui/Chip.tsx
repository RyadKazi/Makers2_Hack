import { Check, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role'> & {
  selected: boolean;
  icon?: LucideIcon;
  /** "toggle" → aria-pressed; "checkbox" → role=checkbox in a multi-select group. */
  mode?: 'toggle' | 'checkbox';
  description?: ReactNode;
  children: ReactNode;
};

/** 48 px pill. Selection is shown by fill + check icon (+ ARIA state), not colour alone. */
export function Chip({ selected, icon: Icon, mode = 'toggle', description, className, children, ...rest }: ChipProps) {
  const a11y = mode === 'checkbox' ? { role: 'checkbox' as const, 'aria-checked': selected } : { 'aria-pressed': selected };
  return (
    <button
      type="button"
      {...a11y}
      className={cn(
        'inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-start text-base font-bold transition-colors duration-fast',
        description && 'rounded-card py-2',
        selected ? 'border-2 border-primary bg-primary-50 text-ink hc:bg-primary hc:text-on-primary' : 'border-control bg-card text-ink hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {selected ? <Check aria-hidden className="size-5 shrink-0 text-primary hc:text-on-primary" /> : Icon ? <Icon aria-hidden className="size-5 shrink-0" /> : null}
      <span className="flex flex-col">
        <span>{children}</span>
        {description ? <span className="text-sm font-normal text-muted hc:text-current">{description}</span> : null}
      </span>
    </button>
  );
}
