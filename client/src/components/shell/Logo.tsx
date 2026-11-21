import { cn } from '@/lib/cn';

/** Supplied accesU mark, kept separate for the compact navigation rail. */
export function LogoMark({ className }: { className?: string }) {
  return <img src="/brand/accesu-mark-black.jpg" alt="" aria-hidden className={cn('size-9 shrink-0 rounded-lg object-cover', className)} />;
}

export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  if (collapsed) {
    return (
      <span aria-label="accesU">
        <LogoMark />
      </span>
    );
  }

  return (
    <img
      src="/brand/accesu-logo-black.jpg"
      alt="accesU"
      className={cn('w-auto rounded-lg object-contain', className ?? 'h-12 max-w-28')}
    />
  );
}
