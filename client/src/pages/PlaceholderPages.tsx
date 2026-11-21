import { Accessibility, Compass, MessagesSquare, Palette, Settings, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Feedback';
import { Page } from '@/components/shell/Page';
import { useAuth } from '@/stores/auth';

const SECTIONS = {
  talk: MessagesSquare,
} as const;

/** Sections whose UI is built in later steps. */
export function ComingSoonPage({ section }: { section: keyof typeof SECTIONS }) {
  const { t } = useTranslation();
  const icon = SECTIONS[section];
  return (
    <Page title={t(`page.${section}`)}>
      <Card className="mx-auto max-w-xl rounded-card border border-line bg-card shadow-card">
        <EmptyState icon={icon} title={t('empty.soonTitle')} text={t('empty.soonText')} />
      </Card>
    </Page>
  );
}

export function MorePage() {
  const { t } = useTranslation();
  const isAdmin = useAuth((s) => s.user?.role === 'ADMIN');
  const links = [
    ...(isAdmin ? [{ to: '/admin', label: t('nav.admin'), icon: ShieldCheck }] : []),
    { to: '/settings', label: t('nav.settings'), icon: Settings },
    { to: '/profile', label: t('nav.profile'), icon: Accessibility },
    { to: '/design-system', label: t('nav.designSystem'), icon: Palette },
  ];
  return (
    <Page title={t('more.title')}>
      <p className="mb-4 text-base text-muted">{t('more.text')}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card shadow-card">
        {links.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-14 items-center gap-4 px-5 text-base font-bold text-ink transition-colors duration-fast hover:bg-cream">
              <Icon aria-hidden className="size-6 text-primary" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('page.notFound')}>
      <Card className="mx-auto max-w-xl rounded-card border border-line bg-card shadow-card">
        <EmptyState
          icon={Compass}
          title={t('page.notFound')}
          text={t('empty.notFoundText')}
          action={
            <Link to="/" className="inline-flex min-h-12 items-center rounded-control bg-primary px-5 font-bold text-on-primary shadow-card hover:bg-primary-800">
              {t('common.home')}
            </Link>
          }
        />
      </Card>
    </Page>
  );
}
