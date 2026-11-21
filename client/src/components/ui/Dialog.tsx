import { X } from 'lucide-react';
import { useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap, useInertBackground } from '@/a11y/focus';
import { cn } from '@/lib/cn';
import { useIds } from '@/lib/hooks';
import { IconButton } from './Button';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  size?: 'md' | 'lg';
  /** Top-aligned (command palette) instead of centred. */
  placement?: 'center' | 'top';
};

/** Modal dialog: portal, focus trap, Escape, inert background, focus returns to the opener. */
export function Dialog({ open, onClose, title, description, children, footer, initialFocus, size = 'md', placement = 'center' }: DialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const ids = useIds('title', 'desc');
  useFocusTrap(ref, open, { onEscape: onClose, ...(initialFocus ? { initialFocus } : {}) });
  useInertBackground(open);
  if (!open) return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-overlay flex justify-center p-4', placement === 'center' ? 'items-center' : 'items-start pt-[10vh]')}>
      <div aria-hidden className="absolute inset-0 bg-ink/50 hc:bg-black/80" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-describedby={description ? ids.desc : undefined}
        tabIndex={-1}
        className={cn('relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-card border border-line bg-card shadow-float', size === 'md' ? 'max-w-lg' : 'max-w-2xl')}
      >
        <div className="flex items-start gap-3 p-5 pb-2 desk:p-6 desk:pb-2">
          <div className="min-w-0 flex-1">
            <h2 id={ids.title} className="text-h2 text-ink">
              {title}
            </h2>
            {description ? (
              <p id={ids.desc} className="mt-1 text-base text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon={X} label={t('common.close')} onClick={onClose} className="-me-2 -mt-1" />
        </div>
        {children ? <div className="overflow-y-auto px-5 pb-5 desk:px-6 desk:pb-6">{children}</div> : null}
        {footer ? <div className="flex flex-wrap justify-end gap-3 border-t border-line p-4 desk:px-6">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
