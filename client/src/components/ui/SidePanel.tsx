import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap, useInertBackground } from '@/a11y/focus';
import { cn } from '@/lib/cn';
import { useIds } from '@/lib/hooks';
import { IconButton } from './Button';

export type SidePanelProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** "inline": a 400 px column on the logical end side (desktop). "overlay": a modal drawer. */
  mode: 'inline' | 'overlay';
  footer?: ReactNode;
};

/** Right panel (end side, so it moves to the left in RTL). */
export function SidePanel({ open, onClose, title, children, mode, footer }: SidePanelProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const ids = useIds('title');
  const overlay = mode === 'overlay';
  useFocusTrap(ref, open && overlay, { onEscape: onClose });
  useInertBackground(open && overlay);
  if (!open) return null;

  const panel = (
    <aside
      ref={ref}
      aria-labelledby={ids.title}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay || undefined}
      tabIndex={-1}
      className={cn(
        'flex flex-col bg-card',
        overlay ? 'fixed inset-y-0 end-0 z-overlay w-[min(25rem,92vw)] border-s border-line shadow-float hc:border-s-2 hc:border-white' : 'h-full w-panel shrink-0 border-s border-line hc:border-s-2 hc:border-white',
      )}
    >
      <div className="flex min-h-16 items-center gap-2 border-b border-line ps-5 pe-2">
        <h2 id={ids.title} className="min-w-0 flex-1 truncate text-h3 text-ink">
          {title}
        </h2>
        <IconButton icon={X} label={t('common.close')} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      {footer ? <div className="border-t border-line p-4">{footer}</div> : null}
    </aside>
  );

  return overlay
    ? createPortal(
        <>
          <div aria-hidden className="fixed inset-0 z-overlay bg-ink/40 hc:bg-black/80" onClick={onClose} />
          {panel}
        </>,
        document.body,
      )
    : panel;
}
