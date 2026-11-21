import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap, useInertBackground } from '@/a11y/focus';
import { cn } from '@/lib/cn';
import { useIds } from '@/lib/hooks';

export type Snap = 'peek' | 'half' | 'full';
export const SNAPS: readonly Snap[] = ['peek', 'half', 'full'];
/** Height of each snap point, as a share of the viewport. */
export const SNAP_HEIGHT: Record<Snap, number> = { peek: 0.25, half: 0.55, full: 0.92 };

export type BottomSheetProps = {
  open: boolean;
  title: ReactNode;
  snap: Snap;
  onSnapChange: (snap: Snap) => void;
  /** Modal sheets trap focus and close on Escape / scrim. Non-modal ones are labelled regions (e.g. over the map). */
  modal?: boolean;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

const nearestSnap = (heightRatio: number): Snap =>
  SNAPS.reduce((best, s) => (Math.abs(SNAP_HEIGHT[s] - heightRatio) < Math.abs(SNAP_HEIGHT[best] - heightRatio) ? s : best), 'half' as Snap);

/**
 * Mobile bottom sheet with 3 snap points. The drag handle is a real 48 px button:
 * click cycles the snap points, ↑/↓ and Page Up/Down change them, pointer drag snaps to the nearest.
 */
export function BottomSheet({ open, title, snap, onSnapChange, modal = false, onClose, children, footer }: BottomSheetProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);
  const ids = useIds('title');
  // Start on the sheet itself (announced as a dialog), not on the drag handle.
  useFocusTrap(ref, open && modal, { onEscape: onClose, initialFocus: ref });
  useInertBackground(open && modal);

  if (!open) return null;

  const index = SNAPS.indexOf(snap);
  const step = (delta: number) => onSnapChange(SNAPS[Math.min(SNAPS.length - 1, Math.max(0, index + delta))]!);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'PageUp') step(1);
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') step(-1);
    else if (e.key === 'Home') onSnapChange('full');
    else if (e.key === 'End') onSnapChange('peek');
    else return;
    e.preventDefault();
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    drag.current = { startY: e.clientY, startH: el.getBoundingClientRect().height, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    el.style.height = `${Math.max(80, Math.min(window.innerHeight * SNAP_HEIGHT.full, d.startH + dy))}px`;
  };
  const onPointerUp = () => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    const ratio = el.getBoundingClientRect().height / window.innerHeight;
    el.style.height = '';
    if (d.moved) onSnapChange(nearestSnap(ratio));
  };

  const sheet = (
    <div
      ref={ref}
      role={modal ? 'dialog' : 'region'}
      aria-modal={modal || undefined}
      aria-labelledby={ids.title}
      tabIndex={-1}
      style={{ height: `${SNAP_HEIGHT[snap] * 100}dvh` }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-sheet flex flex-col rounded-t-card border border-line bg-card shadow-float',
        'transition-[height] duration-sheet ease-sheet',
      )}
      data-snap={snap}
    >
      <button
        type="button"
        aria-label={t('sheet.handle', { state: t(`sheet.${snap}`) })}
        onClick={(e) => {
          if (e.detail === 0 || !drag.current) onSnapChange(SNAPS[(index + 1) % SNAPS.length]!);
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="mx-auto flex min-h-12 w-24 shrink-0 touch-none cursor-grab items-center justify-center"
      >
        <span aria-hidden className="h-1 w-9 rounded-full bg-muted" />
      </button>
      <h2 id={ids.title} className="px-5 text-h3 text-ink">
        {title}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">{children}</div>
      {footer ? <div className="border-t border-line p-4 pb-safe">{footer}</div> : null}
    </div>
  );

  return modal
    ? createPortal(
        <>
          <div aria-hidden className="fixed inset-0 z-sheet bg-ink/40 hc:bg-black/80" onClick={onClose} />
          {sheet}
        </>,
        document.body,
      )
    : sheet;
}
