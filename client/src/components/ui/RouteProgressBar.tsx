import { Navigation, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface RouteProgressBarProps {
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  progressPercent?: number;
  etaText?: string;
  distanceText?: string;
  statusLabel?: string;
  className?: string;
}

export function RouteProgressBar({
  originCode,
  originName,
  destinationCode,
  destinationName,
  progressPercent = 45,
  etaText,
  distanceText,
  statusLabel = 'Chemin Optimal Dijkstra',
  className,
}: RouteProgressBarProps) {
  const pct = Math.max(0, Math.min(100, progressPercent));

  return (
    <div className={cn('flex flex-col gap-3 rounded-card border border-line bg-card p-5 shadow-card card-interactive', className)}>
      {/* Top Header: Departure -> Arrival Codes and Status Badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-ink">{originCode}</span>
          <span className="text-muted font-bold">→</span>
          <span className="text-xl font-black text-ink">{destinationCode}</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-sm font-bold text-primary border border-primary/20">
          <Sparkles className="size-3 text-primary" />
          {statusLabel}
        </span>
      </div>

      {/* Origin / Destination Sub-Labels */}
      <div className="flex items-center justify-between text-sm text-muted">
        <span className="truncate max-w-[45%] font-medium">{originName}</span>
        <span className="truncate max-w-[45%] font-medium text-end">{destinationName}</span>
      </div>

      {/* Horizontal Route Progress Line */}
      <div className="relative my-2 flex items-center">
        {/* Track Line */}
        <div className="h-1.5 w-full rounded-full bg-surface-2" />
        {/* Active Filled Line */}
        <div
          className="absolute start-0 top-0 h-1.5 rounded-full bg-gradient-to-r from-primary to-primary-800 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />

        {/* Start Dot */}
        <div className="absolute start-0 size-3 -translate-y-[0px] rounded-full bg-primary ring-4 ring-primary/20" />

        {/* Moving Pin / Icon along track */}
        <div
          className="absolute flex size-6 -translate-y-[2px] -translate-x-1/2 items-center justify-center rounded-full bg-primary text-on-primary shadow-card transition-all duration-700 ease-out"
          style={{ left: `${pct}%` }}
        >
          <Navigation className="size-3.5 fill-current rotate-45" />
        </div>

        {/* End Dot */}
        <div className="absolute end-0 size-3 -translate-y-[0px] rounded-full bg-line-strong ring-4 ring-line/20" />
      </div>

      {/* Bottom Summary: ETA & Distance */}
      {(etaText || distanceText) && (
        <div className="flex items-center justify-between border-t border-line pt-1 text-sm font-bold">
          <span className="text-muted">Temps estimé : <strong className="text-ink">{etaText}</strong></span>
          <span className="text-muted">Distance : <strong className="text-ink">{distanceText}</strong></span>
        </div>
      )}
    </div>
  );
}
