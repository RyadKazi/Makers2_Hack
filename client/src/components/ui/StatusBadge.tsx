import { CircleCheck, GraduationCap, Lock, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoomStatusCode } from '@/api/types';
import { cn } from '@/lib/cn';

type StatusStyle = { icon: LucideIcon; pattern: string; tone: string; swatch: string };

/** Available and Dr/Teacher occupied classes are green with solid badge; admin = lock + diagonal stripes; club = group + dots. */
export const STATUS_STYLE: Record<RoomStatusCode, StatusStyle> = {
  AVAILABLE: { icon: CircleCheck, pattern: 'pattern-solid', tone: 'bg-available-bg text-available', swatch: 'text-available' },
  TEACHER: { icon: GraduationCap, pattern: 'pattern-stripes', tone: 'bg-available-bg text-available', swatch: 'text-available' },
  ADMIN: { icon: Lock, pattern: 'pattern-stripes', tone: 'bg-occupied-bg text-occupied', swatch: 'text-occupied' },
  CLUB: { icon: Users, pattern: 'pattern-dots', tone: 'bg-club-bg text-club', swatch: 'text-club' },
};

export type StatusBadgeProps = {
  status: RoomStatusCode;
  /** Server label (localised); falls back to the client translation. */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * Pill = pattern swatch + icon + label. The pattern sits in its own swatch so the
 * label keeps full contrast. Three cues besides colour: icon, label, pattern.
 */
export function StatusBadge({ status, label, size = 'md', className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full font-bold hc:border-2 hc:border-white',
        size === 'md' ? 'h-8 pe-3 ps-1 text-sm' : 'h-7 pe-2.5 ps-0.5 text-sm',
        s.tone,
        className,
      )}
      data-status={status}
    >
      <span aria-hidden className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-current', size === 'md' ? 'size-6' : 'size-5', s.swatch)}>
        <span className={cn('absolute inset-0', s.pattern, (status === 'AVAILABLE' || status === 'TEACHER') && 'opacity-100')} />
        <Icon className={cn('relative size-3.5', (status === 'AVAILABLE' || status === 'TEACHER') ? 'text-available-bg hc:text-black' : 'rounded-full bg-[rgb(var(--c-card))] p-px')} />
      </span>
      <span>{label ?? t(`status.${status}`)}</span>
    </span>
  );
}
