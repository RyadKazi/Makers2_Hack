import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('inert') && el.getClientRects().length > 0);
}

type TrapOptions = {
  /** Element to focus first (defaults to the first focusable, then the container). */
  initialFocus?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  /** Return focus to the element that had it before opening (default true). */
  returnFocus?: boolean;
};

/** Keeps Tab / Shift+Tab inside `ref` while `active`; Escape calls onEscape; focus returns on close. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, { initialFocus, onEscape, returnFocus = true }: TrapOptions = {}): void {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const target = initialFocus?.current ?? focusableIn(root)[0] ?? root;
    // Let the element render before focusing (portals, transitions).
    const raf = requestAnimationFrame(() => target.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escape.current) {
        e.stopPropagation();
        escape.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('keydown', onKeyDown);
      if (returnFocus && previous && document.contains(previous)) previous.focus();
    };
  }, [active, ref, initialFocus, returnFocus]);
}

/** Makes the app root inert while a modal is open (screen readers and Tab cannot reach it). */
export function useInertBackground(active: boolean): void {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!active || !root) return undefined;
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
    return () => {
      root.removeAttribute('inert');
      root.removeAttribute('aria-hidden');
    };
  }, [active]);
}
