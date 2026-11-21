/**
 * Every page renders its <h1> through <Page>. On client-side navigation the title
 * is updated, the new page is announced, and focus moves to the heading so
 * keyboard and screen-reader users start at the top of the new content.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAnnounce } from '@/a11y/Announcer';
import { cn } from '@/lib/cn';

let firstPage = true;

export function Page({ title, description, actions, children, className, hideTitle }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string; hideTitle?: boolean }) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { pathname } = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
  }, [title, t]);

  useEffect(() => {
    if (firstPage) {
      firstPage = false;
      return;
    }
    heading.current?.focus();
    announce(t('page.loaded', { title }));
    // Only on navigation, not on title re-render (language switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div className={cn('mx-auto w-full max-w-6xl', className)}>
      <div className={cn('mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5', hideTitle && 'sr-only')}>
        <div>
          <h1 ref={heading} tabIndex={-1} id="page-title" className="text-h1 text-ink">
            {title}
          </h1>
          {description ? <p className="mt-1 text-base text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main"
      className="sr-only-focusable fixed start-4 top-4 z-toast rounded-control bg-primary px-5 py-3 text-base font-bold text-on-primary shadow-float"
    >
      {t('skip.main')}
    </a>
  );
}
