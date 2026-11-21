/**
 * Audio guidance for blind users: a minimal high-contrast screen (forced), huge text,
 * three big buttons (Repeat / Where am I / Pause) and shortcuts (Space, W, P, Enter).
 * Every spoken message is mirrored in a live region, so screen readers get it too.
 */
import { Eye, MapPinned, Pause, Play, Repeat2, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchIndex } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/cn';
import { formatUnit } from '@/lib/format';
import type { Lang } from '@/stores/preferences';
import { useNav } from './navStore';
import { usePosition } from './position';
import { remainingOf, PendingAlert } from './NavigationView';
import { useFloorName } from './RouteMap';
import { metresToNextStep } from './routeModel';
import { stepIcon } from './stepIcons';

/** "Where am I?": floor, nearest named place, current step, next decision, wall to follow, accuracy. */
export function useWhereAmI() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const index = useSearchIndex();
  const floorName = useFloorName();
  return useCallback((): string => {
    const pos = usePosition.getState().position;
    const nav = useNav.getState();
    const m = (n: number) => formatUnit(Math.round(n), 'meter', lang);
    const parts: string[] = [];
    if (!pos) parts.push(t('guide.position.none'));
    else {
      parts.push(pos.floorId ? t('guide.where.floor', { floor: floorName({ floorId: pos.floorId, level: pos.level }) }) : t('guide.where.outdoors'));
      const near = (index.data?.pois ?? [])
        .filter((p) => p.floorId === pos.floorId && p.level === pos.level)
        .map((p) => ({ p, dist: Math.hypot(p.x - pos.x, p.y - pos.y) }))
        .sort((a, b) => a.dist - b.dist)[0];
      const nearName = near ? (lang === 'ar' && near.p.nameAr ? near.p.nameAr : near.p.name) : '';
      if (near && near.dist < 2) parts.push(t('guide.where.at', { place: nearName }));
      else if (near && near.dist <= 20) parts.push(t('guide.where.near', { place: nearName, distance: m(near.dist) }));
      else if (pos.label) parts.push(t('guide.where.at', { place: pos.label }));
    }
    const step = nav.option?.steps.find((s) => s.index === nav.stepIndex);
    if (step && nav.track) {
      parts.push(t('guide.where.step', { instruction: step.instruction }));
      const next = nav.option?.steps.find((s) => s.index === step.index + 1);
      if (next) parts.push(t('guide.where.next', { distance: m(metresToNextStep(nav.track, step.index, nav.d)), instruction: next.instruction }));
      if (step.shoreline) parts.push(t(`guide.where.shoreline.${step.shoreline.side}`, { feature: t(`guide.where.feature.${step.shoreline.feature}`) }));
    }
    if (nav.offRouteM !== null && nav.offRouteM > 8) parts.push(t('guide.where.offRoute', { distance: m(nav.offRouteM) }));
    if (pos) parts.push(t('guide.where.source', { source: t(`guide.position.source.${pos.source}`), accuracy: t('guide.position.accuracyLong', { distance: m(pos.accuracyM) }) }));
    return parts.join(' ');
  }, [t, lang, index.data, floorName]);
}

function BigButton({ icon: Icon, label, shortcut, onClick, pressed }: { icon: typeof Repeat2; label: string; shortcut: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-card border-4 border-primary bg-card p-4 text-3xl font-bold text-ink hover:bg-primary hover:text-on-primary aria-pressed:bg-primary aria-pressed:text-on-primary"
    >
      <Icon aria-hidden className="size-12" />
      {label}
    </button>
  );
}

export function AudioNavigation({ onStop, onVisual, onAccept, onRetry, onChange, repeat, children }: { onStop: () => void; onVisual: () => void; onAccept: () => void; onRetry: () => void; onChange: () => void; repeat: () => void; children?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const option = useNav((s) => s.option);
  const track = useNav((s) => s.track);
  const stepIndex = useNav((s) => s.stepIndex);
  const d = useNav((s) => s.d);
  const paused = useNav((s) => s.paused);
  const voice = useNav((s) => s.voice);
  const message = useNav((s) => s.message);
  const pending = useNav((s) => s.pending);
  const label = useNav((s) => s.destinationLabel);
  const whereAmI = useWhereAmI();
  const root = useRef<HTMLElement>(null);

  const where = useCallback(() => useNav.getState().say(whereAmI(), 'assertive'), [whereAmI]);
  const togglePause = useCallback(() => {
    const nav = useNav.getState();
    nav.setPaused(!nav.paused);
    nav.say(nav.paused ? t('guide.audio.resumed') : t('guide.audio.paused'), 'assertive');
    if (nav.paused) window.setTimeout(repeat, 50);
  }, [repeat, t]);

  // Start at the top: title and current instruction first.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    root.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  // Shortcuts, unless typing or a control has focus (Space / Enter then act on that control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const onControl = !!el.closest('button, a');
      const key = e.key.toLowerCase();
      if (key === ' ' && !onControl) {
        e.preventDefault();
        repeat();
      } else if (key === 'w') {
        e.preventDefault();
        where();
      } else if (key === 'p') {
        e.preventDefault();
        togglePause();
      } else if (key === 'enter' && !onControl && useNav.getState().pending?.kind === 'reroute') {
        e.preventDefault();
        onAccept();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [repeat, where, togglePause, onAccept]);

  if (!option || !track) return null;
  const step = option.steps.find((s) => s.index === stepIndex) ?? option.steps[0]!;
  const Icon = stepIcon(step);
  const { metres } = remainingOf(option, track.total, d);

  return (
    <section
      ref={root}
      tabIndex={-1}
      data-theme="hc"
      aria-labelledby="audio-title"
      className="flex min-h-[80dvh] flex-col gap-6 rounded-card bg-canvas p-5 text-ink outline-none sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="audio-title" className="text-2xl font-bold">
          {t('guide.audio.title')} · {t('guide.toPlace', { place: label })}
        </h2>
        <p className="text-xl font-bold tabular-nums">{t('guide.audio.left', { distance: formatUnit(Math.round(metres), 'meter', lang) })}</p>
      </div>

      <PendingAlert big onAccept={onAccept} onRetry={onRetry} onChange={onChange} />

      <div className="flex items-start gap-4">
        <Icon aria-hidden className="size-16 shrink-0 text-primary" />
        <p className="text-4xl font-bold">{pending ? null : step.instruction}</p>
      </div>

      {/* Mirror of everything spoken (aria-live): screen readers and deaf-blind braille users get the same messages. */}
      <div className="rounded-card border-2 border-line p-4">
        <p className="text-base font-bold">{t('guide.audio.lastMessage')}</p>
        <p aria-live="polite" aria-atomic="true" className="text-2xl">
          {message?.politeness === 'polite' ? message.text : null}
        </p>
        <p aria-live="assertive" aria-atomic="true" className="text-2xl">
          {message?.politeness === 'assertive' ? message.text : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BigButton icon={Repeat2} label={t('guide.audio.repeat')} shortcut="Space" onClick={repeat} />
        <BigButton icon={MapPinned} label={t('guide.audio.whereAmI')} shortcut="W" onClick={where} />
        <BigButton icon={paused ? Play : Pause} label={paused ? t('guide.audio.resume') : t('guide.audio.pause')} shortcut="P" onClick={togglePause} pressed={paused} />
      </div>
      <p className="text-xl">{t('guide.audio.shortcuts')}</p>

      <div className={cn('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center')}>
        <Toggle checked={voice} onChange={(v) => useNav.getState().setVoice(v)} label={t('guide.audio.voice')} hint={t('guide.audio.voiceHint')} className="sm:max-w-md" />
        <Button size="lg" variant="secondary" icon={Eye} onClick={onVisual}>
          {t('guide.audio.exit')}
        </Button>
        <Button size="lg" variant="danger-outline" icon={Square} onClick={onStop}>
          {t('guide.stop')}
        </Button>
      </div>
      {children}
    </section>
  );
}
