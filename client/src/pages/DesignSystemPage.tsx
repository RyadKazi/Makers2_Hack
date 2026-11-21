import { Accessibility, ArrowRight, ArrowUp, Bell, DoorOpen, Mail, MapPin, Plus, Route, Search, Trash2, TrendingUp, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet, type Snap } from '@/components/ui/BottomSheet';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, CardHeader, IconTile } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { Toggle } from '@/components/ui/Toggle';
import { useToast } from '@/components/ui/Toast';
import { Page } from '@/components/shell/Page';
import { useRightPanel } from '@/components/shell/RightPanel';
import { contrastRatio, toHex, tokenRgb } from '@/lib/contrast';
import { useMediaQuery } from '@/lib/hooks';
import { formatNumber, formatUnit } from '@/lib/format';
import { usePreferences, type Lang } from '@/stores/preferences';

/** Text-on-background pairs shown with their live contrast ratio. */
const PAIRS: { fg: string; bg: string; name: string }[] = [
  { fg: 'ink', bg: 'card', name: 'ink / card' },
  { fg: 'muted', bg: 'card', name: 'muted / card' },
  { fg: 'on-primary', bg: 'primary', name: 'on-primary / primary' },
  { fg: 'primary', bg: 'card', name: 'primary / card' },
  { fg: 'route-text', bg: 'card', name: 'route text / card' },
  { fg: 'available', bg: 'available-bg', name: 'available' },
  { fg: 'occupied', bg: 'occupied-bg', name: 'teacher / admin' },
  { fg: 'club', bg: 'club-bg', name: 'club' },
  { fg: 'warning', bg: 'warning-bg', name: 'warning' },
];

function Swatches() {
  const { t } = useTranslation();
  const theme = usePreferences((s) => s.theme);
  const textScale = usePreferences((s) => s.textScale);
  const [rows, setRows] = useState<{ name: string; fg: string; bg: string; ratio: number }[]>([]);
  useEffect(() => {
    // Read after the theme attribute is applied.
    const id = requestAnimationFrame(() => {
      const read = (name: string) => {
        try {
          return tokenRgb(name);
        } catch {
          return null; // styles not loaded (e.g. tests)
        }
      };
      setRows(
        PAIRS.flatMap((p) => {
          const fg = read(p.fg);
          const bg = read(p.bg);
          return fg && bg ? [{ name: p.name, fg: toHex(fg), bg: toHex(bg), ratio: contrastRatio(fg, bg) }] : [];
        }),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [theme, textScale]);
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
      {rows.map((r) => (
        <li key={r.name} className="flex items-center gap-3 rounded-card border border-line bg-card p-3">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-control border border-line text-lg font-bold" style={{ background: r.bg, color: r.fg }}>
            Aa
          </span>
          <span className="min-w-0">
            <span className="block text-base font-bold text-ink">{r.name}</span>
            <span className="block text-sm text-muted tabular">
              {r.fg} / {r.bg} · {t('ds.contrast', { ratio: r.ratio })} {r.ratio >= 4.5 ? '✓ AA' : '✗'}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DesignSystemPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const toast = useToast();
  const panel = useRightPanel();
  const mobile = !useMediaQuery('(min-width: 768px)');
  const [tab, setTab] = useState<'map' | 'list' | 'audio'>('map');
  const [chips, setChips] = useState<string[]>(['stepFree']);
  const [toggle, setToggle] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [snap, setSnap] = useState<Snap>('half');
  const [email, setEmail] = useState('');

  const section = (id: string, title: string, children: React.ReactNode) => (
    <Card aria-labelledby={id}>
      <CardHeader title={title} titleId={id} />
      {children}
    </Card>
  );

  return (
    <Page title={t('ds.title')}>
      <p className="mb-6 max-w-prose text-base text-muted">{t('ds.intro')}</p>
      <div className="flex flex-col gap-4">
        {section('ds-colors', t('ds.colors'), <Swatches />)}

        {section(
          'ds-type',
          t('ds.type'),
          <div className="flex flex-col gap-3">
            <p className="text-display text-ink">Display — {t('ds.sample')}</p>
            <p className="text-h1 text-ink">H1 — {t('ds.sample')}</p>
            <p className="text-h2 text-ink">H2 — {t('ds.sample')}</p>
            <p className="text-h3 text-ink">H3 — {t('ds.sample')}</p>
            <p className="text-kpi text-ink tabular">1 284</p>
            <p className="text-base text-ink">Body 16 — {t('landing.text')}</p>
            <p className="text-sm text-muted">Small 14 — {t('landing.footer')}</p>
          </div>,
        )}

        {section(
          'ds-buttons',
          t('ds.buttons'),
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={Route}>{t('nav.navigate')}</Button>
            <Button variant="secondary" iconEnd={ArrowRight} flipIconEnd>
              {t('common.next')}
            </Button>
            <Button variant="ghost">{t('common.cancel')}</Button>
            <Button variant="danger" icon={Trash2}>
              {t('common.dismiss')}
            </Button>
            <Button variant="danger-outline">{t('common.close')}</Button>
            <Button loading>{t('common.saving')}</Button>
            <Button disabled>{t('common.save')}</Button>
            <Button size="lg" icon={Plus}>
              {t('common.save')}
            </Button>
            <IconButton icon={Bell} label="Notifications" badge={3} />
            <IconButton icon={Search} label={t('topbar.search')} variant="secondary" />
            <IconButton icon={Plus} label="Zoom +" variant="float" />
          </div>,
        )}

        {section(
          'ds-inputs',
          t('ds.inputs'),
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('login.email')} icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint={t('login.subtitle')} />
            <Input label={t('login.password')} type="password" error={t('common.required')} defaultValue="" />
            <Select label={t('topbar.floor')} defaultValue="0">
              <option value="0">Bloc A · Rez-de-chaussée</option>
              <option value="1">Bloc A · 1er étage</option>
            </Select>
          </div>,
        )}

        {section(
          'ds-chips',
          t('ds.chips'),
          <div className="flex flex-col gap-4">
            <div role="group" aria-label={t('onboarding.routingTitle')} className="flex flex-wrap gap-2">
              {(['stepFree', 'requireVerifiedRamps', 'audioGuidance'] as const).map((k) => (
                <Chip key={k} mode="checkbox" selected={chips.includes(k)} icon={Accessibility} onClick={() => setChips((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))}>
                  {t(`onboarding.prefs.${k}.label`)}
                </Chip>
              ))}
            </div>
            <div className="max-w-xl">
              <Toggle checked={toggle} onChange={setToggle} label={t('onboarding.prefs.shorelineHints.label')} hint={t('onboarding.prefs.shorelineHints.hint')} />
            </div>
          </div>,
        )}

        {section(
          'ds-tabs',
          t('ds.tabs'),
          <>
            <Tabs
              idBase="ds-tabs"
              label={t('ds.tabs')}
              value={tab}
              onChange={setTab}
              items={[
                { value: 'map', label: t('nav.map') },
                { value: 'list', label: t('nav.rooms') },
                { value: 'audio', label: t('onboarding.prefs.audioGuidance.label') },
              ]}
            />
            {(['map', 'list', 'audio'] as const).map((v) => (
              <TabPanel key={v} idBase="ds-tabs" value={v} active={tab === v}>
                <p className="text-base text-ink">{v === 'map' ? t('page.map') : v === 'list' ? t('page.rooms') : t('onboarding.prefs.audioGuidance.hint')}</p>
              </TabPanel>
            ))}
          </>,
        )}

        {section(
          'ds-status',
          t('ds.status'),
          <div className="flex flex-wrap gap-3">
            {(['AVAILABLE', 'TEACHER', 'ADMIN', 'CLUB'] as const).map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>,
        )}

        {section(
          'ds-cards',
          t('ds.cards'),
          <div className="grid gap-4 desk:grid-cols-3">
            <Card as="article" className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <IconTile icon={Users} />
                <h3 className="text-base font-bold text-ink">{t('nav.rooms')}</h3>
              </div>
              <p className="text-kpi text-ink tabular">44</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="available" icon={ArrowUp}>
                  {`+${formatUnit(12, 'percent', lang)}`}
                </Badge>
                <span className="text-sm text-muted">7 j</span>
              </div>
            </Card>
            <Card as="article" className="flex flex-col gap-3 desk:col-span-2">
              <div className="flex flex-wrap items-start gap-3">
                <IconTile icon={DoorOpen} tone="route" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-h3 text-ink">A-104 · Salle de TD</h3>
                  <p className="flex items-center gap-1 text-sm text-muted">
                    <MapPin aria-hidden className="size-4" />
                    Bloc A · 1er étage
                  </p>
                </div>
                <StatusBadge status="TEACHER" />
              </div>
              <dl className="grid grid-cols-3 divide-x divide-line rtl:divide-x-reverse">
                {[
                  ['Capacité', formatNumber(40, lang)],
                  ['Porte', formatUnit(90, 'centimeter', lang)],
                  ['Ascenseur', formatUnit(18, 'meter', lang)],
                ].map(([k, v]) => (
                  <div key={k} className="px-3 first:ps-0">
                    <dt className="text-sm text-muted">{k}</dt>
                    <dd className="text-xl font-bold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex justify-end">
                <Button variant="secondary" iconEnd={ArrowRight} flipIconEnd>
                  {t('nav.navigate')}
                </Button>
              </div>
            </Card>
          </div>,
        )}

        {section(
          'ds-feedback',
          t('ds.feedback'),
          <div className="grid gap-4 desk:grid-cols-2">
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" icon={TrendingUp} onClick={() => toast.show(t('ds.toastText'), { tone: 'success' })}>
                {t('ds.showToast')}
              </Button>
              <Button variant="danger-outline" onClick={() => toast.show(t('ds.errorText'), { tone: 'error', action: { label: t('common.retry'), onClick: () => undefined } })}>
                {t('ds.showError')}
              </Button>
            </div>
            <Skeleton.Group>
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </Skeleton.Group>
            <div className="desk:col-span-2">
              <EmptyState icon={Search} title={t('empty.soonTitle')} text={t('empty.soonText')} headingLevel={3} />
            </div>
          </div>,
        )}

        {section(
          'ds-overlays',
          t('ds.overlays'),
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setDialog(true)}>
              {t('ds.openDialog')}
            </Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>
              {t('ds.openSheet')}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                panel.open({
                  title: 'A-104',
                  body: (
                    <div className="flex flex-col gap-3">
                      <StatusBadge status="TEACHER" />
                      <p className="text-base text-ink">{t('landing.features.status.text')}</p>
                    </div>
                  ),
                })
              }
            >
              {t('ds.openPanel')}
            </Button>
          </div>,
        )}
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title={t('ds.dialogTitle')}
        description={t('ds.dialogText')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => setDialog(false)}>
              {t('common.close')}
            </Button>
          </>
        }
      />
      <BottomSheet
        open={sheet}
        modal
        title="A-104"
        snap={snap}
        onSnapChange={setSnap}
        onClose={() => setSheet(false)}
        footer={
          <Button size="lg" fullWidth icon={Route} onClick={() => setSheet(false)}>
            {t('nav.navigate')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <StatusBadge status="TEACHER" />
          <p className="text-base text-ink">{mobile ? t('landing.features.routes.text') : t('landing.features.status.text')}</p>
        </div>
      </BottomSheet>
    </Page>
  );
}
