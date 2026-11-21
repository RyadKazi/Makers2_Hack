/**
 * Toasts in persistent live regions: polite for info / success, assertive for errors.
 * Info toasts stay 6 s (paused while hovered or focused); errors stay until dismissed.
 */
import { AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

export type ToastTone = 'info' | 'success' | 'error';
type Toast = { id: number; tone: ToastTone; message: string; action?: { label: string; onClick: () => void } };
type ToastApi = { show: (message: string, opts?: { tone?: ToastTone; action?: Toast['action'] }) => void; dismiss: (id: number) => void };

const Ctx = createContext<ToastApi>({ show: () => undefined, dismiss: () => undefined });
export const useToast = (): ToastApi => useContext(Ctx);

const ICON: Record<ToastTone, LucideIcon> = { info: Info, success: CheckCircle2, error: AlertTriangle };
const TONE: Record<ToastTone, string> = { info: 'text-primary', success: 'text-available', error: 'text-danger' };
export const TOAST_MS = 6000;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const Icon = ICON[toast.tone];
  useEffect(() => {
    if (toast.tone === 'error' || paused) return undefined;
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast.tone, paused, onDismiss]);

  // Pausing the timer on hover / focus is an enhancement, not an interaction (WCAG 2.2.1).
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full items-center gap-3 rounded-card border border-line bg-card p-2 ps-4 shadow-card"
    >
      <Icon aria-hidden className={cn('size-6 shrink-0', TONE[toast.tone])} />
      <p className="min-w-0 flex-1 py-2 text-base text-ink">{toast.message}</p>
      {toast.action ? (
        <button
          type="button"
          className="min-h-12 rounded-control px-3 font-bold text-primary hover:bg-surface-2"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton icon={X} label={t('common.dismiss')} onClick={onDismiss} />
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>((message, opts) => {
    const toast: Toast = { id: next.current++, tone: opts?.tone ?? 'info', message, ...(opts?.action ? { action: opts.action } : {}) };
    setToasts((list) => [...list.slice(-3), toast]);
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  const region = (tone: 'polite' | 'assertive') => (
    <ul aria-live={tone} aria-relevant="additions" className="flex flex-col gap-2">
      {toasts
        .filter((x) => (tone === 'assertive' ? x.tone === 'error' : x.tone !== 'error'))
        .map((x) => (
          <ToastItem key={x.id} toast={x} onDismiss={() => dismiss(x.id)} />
        ))}
    </ul>
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <section
        aria-label={t('toast.region')}
        className="pointer-events-none fixed inset-x-4 bottom-24 z-toast mx-auto flex max-w-md flex-col gap-2 tablet:bottom-6 desk:end-6 desk:start-auto desk:top-20 desk:bottom-auto desk:mx-0 desk:w-96"
      >
        {region('assertive')}
        {region('polite')}
      </section>
    </Ctx.Provider>
  );
}
