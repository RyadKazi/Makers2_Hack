import { AlertTriangle, RotateCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { IconTile } from './Card';

/** Placeholder block. Decorative: wrap loading areas in <Skeleton.Group> which sets aria-busy and a hidden label. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block rounded-control bg-surface-2 skeleton-shimmer reduced:bg-none hc:border hc:border-white', className)} />;
}

Skeleton.Group = function SkeletonGroup({ children, label }: { children: ReactNode; label?: string }) {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only" role="status">
        {label ?? t('common.loading')}
      </span>
      {children}
    </div>
  );
};

export function EmptyState({ icon, title, text, action, headingLevel = 2 }: { icon: LucideIcon; title: ReactNode; text?: ReactNode; action?: ReactNode; headingLevel?: 1 | 2 | 3 }) {
  const H = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center">
      <IconTile icon={icon} size="lg" />
      <H className="text-h3 text-ink">{title}</H>
      {text ? <p className="text-base text-muted">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Error with a retry action; announced (role="alert") because it replaces content the user was waiting for. */
export function ErrorState({ title, text, onRetry, retryLabel }: { title: ReactNode; text?: ReactNode; onRetry?: () => void; retryLabel: string }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center">
      <span aria-hidden className="inline-flex size-16 items-center justify-center rounded-control bg-occupied-bg text-occupied hc:border-2 hc:border-white">
        <AlertTriangle className="size-8" />
      </span>
      <p className="text-h3 text-ink">{title}</p>
      {text ? <p className="text-base text-muted">{text}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex min-h-12 items-center gap-2 rounded-control border border-primary bg-primary px-5 font-bold text-on-primary shadow-card hover:bg-primary-800">
          <RotateCw aria-hidden className="size-5" />
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
