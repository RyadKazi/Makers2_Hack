import { Loader2, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border border-primary bg-primary text-on-primary shadow-card hover:bg-primary-800 active:bg-primary-800 hc:border-2 hc:border-primary',
  secondary: 'border border-line bg-primary-50 text-ink shadow-card hover:bg-cream hover:border-soft hc:border-2 hc:border-white',
  ghost: 'bg-transparent text-ink hover:bg-surface-2 hc:underline',
  danger: 'bg-danger text-white hover:opacity-90 hc:bg-black hc:text-white hc:border-2 hc:border-white',
  'danger-outline': 'bg-card text-danger border-2 border-current hover:bg-danger-bg',
};

const SIZES = {
  md: 'min-h-12 gap-2 px-5 text-base',
  lg: 'min-h-14 gap-3 px-6 text-lg',
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof SIZES;
  icon?: LucideIcon;
  iconEnd?: LucideIcon;
  /** Flip start / end icon in RTL (arrows). */
  flipIcon?: boolean;
  flipIconEnd?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
};

/**
 * 48 px minimum. Disabled buttons stay focusable (aria-disabled) so screen-reader
 * users can discover them; clicks are ignored.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconEnd: IconEnd, flipIcon, flipIconEnd, loading, fullWidth, disabled, className, onClick, children, type = 'button', ...rest },
  ref,
) {
  const inactive = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (inactive) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-control font-bold tracking-tight transition-all duration-fast ease-out active:scale-[0.98]',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        inactive && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-5 animate-spin reduced:animate-none" /> : Icon ? <Icon aria-hidden className={cn('size-5 shrink-0', flipIcon && 'flip-rtl')} /> : null}
      <span>{children}</span>
      {IconEnd ? <IconEnd aria-hidden className={cn('size-5 shrink-0', flipIconEnd && 'flip-rtl')} /> : null}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon;
  /** Required accessible name (also shown as a tooltip). */
  label: string;
  variant?: 'ghost' | 'secondary' | 'primary' | 'float';
  flipRtl?: boolean;
  badge?: number;
};

const ICON_VARIANTS = {
  ghost: 'text-ink hover:bg-surface-2',
  secondary: 'border border-line bg-primary-50 text-ink hover:bg-cream hc:border-2 hc:border-white',
  primary: 'border border-primary bg-primary text-on-primary shadow-card hover:bg-primary-800',
  float: 'rounded-control bg-card text-ink border border-line shadow-card hover:bg-surface-2',
} as const;

/** 48 × 48 icon-only button with a mandatory label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = 'ghost', flipRtl, badge, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={badge ? `${label} (${badge})` : label}
      title={label}
      className={cn(
        'relative inline-flex size-12 shrink-0 items-center justify-center rounded-control transition-all duration-fast ease-out active:scale-95',
        ICON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className={cn('size-6', flipRtl && 'flip-rtl')} />
      {badge ? (
        <span aria-hidden className="absolute end-1.5 top-1.5 min-w-5 rounded-full bg-danger px-1 text-center text-sm font-bold leading-5 text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
});
