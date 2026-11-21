import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type CardProps = HTMLAttributes<HTMLElement> & { as?: 'section' | 'article' | 'div'; padded?: boolean };

/** A calm structural surface. Interactive cards opt in to hover feedback themselves. */
export function Card({ as: Tag = 'section', padded = true, className, children, ...rest }: CardProps) {
  return (
    <Tag className={cn('rounded-card border border-line bg-card shadow-card', padded && 'p-5 desk:p-6', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, titleId, actions, level = 2 }: { title: ReactNode; titleId?: string; actions?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3.5">
      <H id={titleId} className="text-h3 text-ink">
        {title}
      </H>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const TILE_TONES = {
  primary: 'bg-primary-50 text-primary',
  route: 'bg-route-100 text-route-text',
  available: 'bg-available-bg text-available',
  occupied: 'bg-occupied-bg text-occupied',
  club: 'bg-club-bg text-club',
  warning: 'bg-warning-bg text-warning',
} as const;

/** Tinted 48 px square icon tile (Image 3). Decorative. */
export function IconTile({ icon: Icon, tone = 'primary', size = 'md' }: { icon: LucideIcon; tone?: keyof typeof TILE_TONES; size?: 'md' | 'lg' }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-control hc:border-2 hc:border-white', TILE_TONES[tone], size === 'md' ? 'size-12' : 'size-16')}>
      <Icon className={size === 'md' ? 'size-6' : 'size-8'} />
    </span>
  );
}

/** Small tinted pill for counts and deltas (meaning also carried by text and icon). */
export function Badge({ tone = 'primary', icon: Icon, children }: { tone?: keyof typeof TILE_TONES; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-bold hc:border-2 hc:border-white', TILE_TONES[tone])}>
      {Icon ? <Icon aria-hidden className="size-4" /> : null}
      {children}
    </span>
  );
}
