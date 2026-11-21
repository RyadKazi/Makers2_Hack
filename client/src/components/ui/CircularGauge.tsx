import { cn } from '@/lib/cn';

export interface CircularGaugeProps {
  value: number; // 0 to 100
  title?: string;
  subtitle?: string;
  tone?: 'amber' | 'emerald' | 'primary' | 'rose';
  className?: string;
}

export function CircularGauge({
  value,
  title = 'Accessibilité Campus',
  subtitle = 'Conformité PMR & Mobilité',
  tone = 'primary',
  className,
}: CircularGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  // Semi-circle arc: radius 52, perimeter of semi-circle = PI * r = 163.36
  const r = 52;
  const semiCircumference = Math.PI * r;
  const strokeDashoffset = semiCircumference * (1 - clamped / 100);

  const toneColor =
    tone === 'amber' || tone === 'primary'
      ? 'rgb(var(--c-primary))'
      : tone === 'emerald'
      ? 'rgb(var(--c-available))'
      : 'rgb(var(--c-occupied))';

  return (
    <div className={cn('flex flex-col items-center rounded-card border border-line bg-card p-5 shadow-card card-interactive', className)}>
      <span className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">{title}</span>
      <div className="relative flex flex-col items-center justify-center">
        <svg viewBox="0 0 130 75" className="w-44 h-26 overflow-visible">
          {/* Background Arc */}
          <path
            d="M 13 65 A 52 52 0 0 1 117 65"
            fill="none"
            stroke="rgb(var(--c-surface-2))"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* In dark card / contrast, dark track */}
          <path
            d="M 13 65 A 52 52 0 0 1 117 65"
            fill="none"
            stroke="currentColor"
            className="text-line/40"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Foreground Animated Value Arc */}
          <path
            d="M 13 65 A 52 52 0 0 1 117 65"
            fill="none"
            stroke={toneColor}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={semiCircumference}
            strokeDashoffset={strokeDashoffset}
            style={{
              transition: 'stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </svg>
        <div className="absolute bottom-0 flex flex-col items-center text-center">
          <span className="text-2xl font-black text-ink tabular-nums">{clamped}%</span>
          <span className="-mt-0.5 text-sm font-bold text-muted">{subtitle}</span>
        </div>
      </div>
    </div>
  );
}
