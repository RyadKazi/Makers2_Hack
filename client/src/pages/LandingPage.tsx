import { Accessibility, ArrowRight, AudioLines, Captions, Languages, LogIn, Route, ShieldCheck, Signal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PublicLayout } from '@/components/shell/AppShell';
import { Page } from '@/components/shell/Page';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';

const FEATURES = [
  { key: 'routes', icon: Route, tone: 'route' },
  { key: 'status', icon: Signal, tone: 'available' },
  { key: 'audio', icon: AudioLines, tone: 'primary' },
  { key: 'talk', icon: Captions, tone: 'club' },
  { key: 'privacy', icon: ShieldCheck, tone: 'primary' },
  { key: 'languages', icon: Languages, tone: 'route' },
] as const;

const linkButton = 'inline-flex min-h-14 items-center justify-center gap-3 rounded-control px-6 text-lg font-bold transition-colors duration-fast';

export function LandingPage() {
  const { t } = useTranslation();
  const signedIn = useAuth((s) => s.status === 'authenticated');
  return (
    <PublicLayout>
      <Page title={t('page.landing')} hideTitle>
        <section aria-labelledby="hero-title" className="max-w-3xl py-8 desk:py-16">
          <div className="flex flex-col gap-5">
            <p className="text-base font-bold text-primary">{t('app.tagline')}</p>
            <h2 id="hero-title" className="text-display text-ink">
              {t('landing.title')}
            </h2>
            <p className="max-w-prose text-lg text-muted">{t('landing.text')}</p>
            <div className="flex flex-wrap gap-3">
              <Link to={signedIn ? '/map' : '/login'} className={cn(linkButton, 'border border-primary bg-primary text-on-primary shadow-card hover:bg-primary-800')}>
                <LogIn aria-hidden className="size-5 flip-rtl" />
                {t('landing.start')}
              </Link>
              <Link to="/map" className={cn(linkButton, 'border-control bg-card text-ink hover:bg-surface-2')}>
                {t('landing.guest')}
                <ArrowRight aria-hidden className="size-5 flip-rtl" />
              </Link>
            </div>
            <Link to="/onboarding" className="inline-flex min-h-12 w-fit items-center gap-2 rounded-control font-bold text-primary underline underline-offset-4">
              <Accessibility aria-hidden className="size-5" />
              {t('landing.setup')}
            </Link>
          </div>
        </section>

        <section aria-labelledby="features-title" className="max-w-5xl border-t border-line py-8">
          <h2 id="features-title" className="mb-5 text-h2 text-ink">
            {t('landing.featuresTitle')}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
            {FEATURES.map(({ key, icon: Icon, tone }) => (
              <li key={key} className="flex gap-3 rounded-card border border-line bg-card p-4">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-control ${tone === 'available' ? 'bg-available-bg text-available' : tone === 'club' ? 'bg-club-bg text-club' : tone === 'route' ? 'bg-route-100 text-route-text' : 'bg-primary-50 text-primary'}`}>
                  <Icon aria-hidden className="size-5" />
                </span>
                  <div>
                    <h3 className="text-base font-bold text-ink">{t(`landing.features.${key}.title`)}</h3>
                    <p className="mt-1 text-sm text-muted">{t(`landing.features.${key}.text`)}</p>
                  </div>
              </li>
            ))}
          </ul>
        </section>
      </Page>
    </PublicLayout>
  );
}
