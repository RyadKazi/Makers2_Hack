/**
 * Accessibility profile wizard (also used to edit it): 1) needs (multi-select),
 * 2) preferences (toggles prefilled from the needs), 3) review & save.
 * Display preferences apply immediately as a live preview.
 */
import { Accessibility, Ear, Eye, MessageSquareText, PersonStanding, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSaveProfile } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { RangeField } from '@/components/ui/Choice';
import { Select } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { useToast } from '@/components/ui/Toast';
import { PublicLayout } from '@/components/shell/AppShell';
import { Page } from '@/components/shell/Page';
import { defaultsFor, EMPTY_DRAFT, NEEDS, needsFrom, primaryMobility, toggleNeed, uiPreferencesFrom, type Need, type ProfileDraft } from '@/features/profile/model';
import { useAuth } from '@/stores/auth';
import { TEXT_SCALE, usePreferences } from '@/stores/preferences';

const NEED_ICON = { WHEELCHAIR: Accessibility, REDUCED_MOBILITY: PersonStanding, BLIND_LOW_VISION: Eye, DEAF_HARD_OF_HEARING: Ear, SPEECH: MessageSquareText, NONE: Check } as const;
const STEPS = ['needs', 'preferences', 'review'] as const;
type BoolKey = 'stepFree' | 'requireVerifiedRamps' | 'audioGuidance' | 'shorelineHints' | 'captions' | 'textToSpeech' | 'highContrast' | 'reducedMotion';

export function ProfileWizard({ standalone }: { standalone: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const save = useSaveProfile();
  const prefs = usePreferences();
  const saved = user?.accessibilityProfile;

  const [step, setStep] = useState(0);
  const [needs, setNeeds] = useState<Need[]>(() => (saved ? needsFrom(saved) : []));
  const [draft, setDraft] = useState<ProfileDraft>(() => (saved && saved.updatedAt ? { ...EMPTY_DRAFT, ...saved } : { ...EMPTY_DRAFT, textScale: prefs.textScale }));
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Focus the step heading when the step changes (not on first render).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    stepHeading.current?.focus();
  }, [step]);

  // Live preview of display preferences.
  useEffect(() => {
    const ui = uiPreferencesFrom(draft, { theme: usePreferences.getState().theme });
    usePreferences.setState({ theme: ui.theme, motion: ui.motion, textScale: ui.textScale });
  }, [draft]);

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const goNext = () => {
    if (step === 0) setDraft((d) => defaultsFor(needs, d));
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const finish = () => {
    const body = { ...draft, mobility: primaryMobility(needs) };
    const done = () => navigate(standalone ? '/map' : '/settings');
    if (!user) {
      toast.show(t('onboarding.signInToSave'), { tone: 'info' });
      done();
      return;
    }
    save.mutate(body, {
      onSuccess: () => {
        toast.show(t('onboarding.saved'), { tone: 'success' });
        done();
      },
      onError: () => toast.show(t('onboarding.saveError'), { tone: 'error' }),
    });
  };

  const toggle = (key: BoolKey) => (
    <Toggle key={key} checked={draft[key]} onChange={(v) => set(key, v)} label={t(`onboarding.prefs.${key}.label`)} hint={t(`onboarding.prefs.${key}.hint`)} />
  );
  const stepId = STEPS[step]!;

  // Accessibility personalisation belongs to students. Data providers are sent
  // directly to their operational workspace even if they reach this URL manually.
  if (user?.role === 'ADMIN') return <Navigate to="/admin" replace />;
  if (user?.role === 'TEACHER') return <Navigate to="/rooms" replace />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted">{t('onboarding.intro')}</p>
      <ol aria-label={t('onboarding.title')} className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={i === step ? 'rounded-control border-2 border-primary bg-cream px-4 py-2 text-sm font-bold text-ink hc:bg-primary hc:text-on-primary' : 'rounded-control border-control bg-card px-4 py-2 text-sm text-muted hover:bg-surface-2'}>
            {i < step ? <Check aria-hidden className="me-1 inline size-4" /> : null}
            {t(`onboarding.steps.${s}`)}
          </li>
        ))}
      </ol>

      <Card>
        <p className="text-sm font-bold text-muted">{t('onboarding.stepOf', { current: step + 1, total: STEPS.length })}</p>
        <h2 ref={stepHeading} tabIndex={-1} className="mb-4 text-h2 text-ink">
          {t(`onboarding.steps.${stepId}`)}
        </h2>

        {stepId === 'needs' ? (
          <div role="group" aria-labelledby="needs-legend">
            <p id="needs-legend" className="mb-3 text-base font-bold text-ink">
              {t('onboarding.needsLegend')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {NEEDS.map((n) => (
                <Chip key={n} mode="checkbox" selected={needs.includes(n)} icon={NEED_ICON[n]} description={t(`onboarding.needs.${n}.hint`)} onClick={() => setNeeds((cur) => toggleNeed(cur, n))} className="w-full justify-start">
                  {t(`onboarding.needs.${n}.label`)}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        {stepId === 'preferences' ? (
          <div className="flex flex-col gap-6">
            <section aria-labelledby="pref-routing" className="rounded-card border border-line bg-canvas p-4">
              <h3 id="pref-routing" className="mb-2 text-h3 text-ink">
                {t('onboarding.routingTitle')}
              </h3>
              {toggle('stepFree')}
              {toggle('requireVerifiedRamps')}
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Select
                  label={t('onboarding.prefs.maxSlopePercent.label')}
                  hint={t('onboarding.prefs.maxSlopePercent.hint')}
                  value={draft.maxSlopePercent ?? ''}
                  onChange={(e) => set('maxSlopePercent', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t('onboarding.prefs.maxSlopePercent.none')}</option>
                  {[5, 6, 8, 10].map((v) => (
                    <option key={v} value={v}>{`${v} %`}</option>
                  ))}
                </Select>
                <Select
                  label={t('onboarding.prefs.minPassageWidthCm.label')}
                  hint={t('onboarding.prefs.minPassageWidthCm.hint')}
                  value={draft.minPassageWidthCm ?? ''}
                  onChange={(e) => set('minPassageWidthCm', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t('onboarding.prefs.minPassageWidthCm.none')}</option>
                  {[80, 85, 90, 100].map((v) => (
                    <option key={v} value={v}>{`${v} cm`}</option>
                  ))}
                </Select>
              </div>
            </section>
            <section aria-labelledby="pref-sensory" className="rounded-card border border-line bg-canvas p-4">
              <h3 id="pref-sensory" className="mb-2 text-h3 text-ink">
                {t('onboarding.sensoryTitle')}
              </h3>
              {toggle('audioGuidance')}
              {toggle('shorelineHints')}
              {toggle('captions')}
              {toggle('textToSpeech')}
            </section>
            <section aria-labelledby="pref-display" className="rounded-card border border-line bg-canvas p-4">
              <h3 id="pref-display" className="mb-2 text-h3 text-ink">
                {t('onboarding.displayTitle')}
              </h3>
              {toggle('highContrast')}
              {toggle('reducedMotion')}
              <div className="mt-3 px-3">
                <RangeField
                  label={t('onboarding.prefs.textScale.label')}
                  hint={t('onboarding.prefs.textScale.hint')}
                  value={draft.textScale}
                  min={TEXT_SCALE.min}
                  max={TEXT_SCALE.max}
                  step={TEXT_SCALE.step}
                  onChange={(v) => set('textScale', v)}
                  format={(v) => `${Math.round(v * 100)} %`}
                />
              </div>
            </section>
          </div>
        ) : null}

        {stepId === 'review' ? (
          <div className="flex flex-col gap-3">
            <p className="text-base text-ink">{t('onboarding.reviewTitle')}</p>
            <ul className="flex flex-wrap gap-2">
              {needs.length === 0 ? <li className="text-base text-muted">{t('onboarding.reviewEmpty')}</li> : null}
              {needs.map((n) => (
                <li key={n} className="rounded-control border border-line bg-cream px-4 py-2 text-base font-bold text-ink hc:border-2 hc:border-white">
                  {t(`onboarding.needs.${n}.label`)}
                </li>
              ))}
            </ul>
            <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {(['stepFree', 'requireVerifiedRamps', 'audioGuidance', 'shorelineHints', 'captions', 'textToSpeech', 'highContrast', 'reducedMotion'] as const).map((k) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line py-2">
                  <dt className="text-base text-ink">{t(`onboarding.prefs.${k}.label`)}</dt>
                  <dd className="text-base font-bold text-ink">{draft[k] ? t('common.on') : t('common.off')}</dd>
                </div>
              ))}
            </dl>
            {!user ? <p className="rounded-control border border-line bg-warning-bg p-4 text-base text-ink hc:border-2 hc:border-white">{t('onboarding.signInToSave')}</p> : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-between gap-3">
          {step > 0 ? (
            <Button variant="secondary" icon={ArrowLeft} flipIcon onClick={() => setStep((s) => s - 1)}>
              {t('common.back')}
            </Button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <Button iconEnd={ArrowRight} flipIconEnd onClick={goNext}>
              {t('common.next')}
            </Button>
          ) : (
            <Button icon={Check} loading={save.isPending} onClick={finish}>
              {save.isPending ? t('common.saving') : t('common.finish')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/** /onboarding: focused layout without the app shell. */
export function OnboardingPage() {
  const { t } = useTranslation();
  return (
    <PublicLayout>
      <Page title={t('onboarding.title')} className="max-w-3xl">
        <ProfileWizard standalone />
      </Page>
    </PublicLayout>
  );
}

/** /profile: the same wizard inside the shell, for editing. */
export function ProfilePage() {
  const { t } = useTranslation();
  return (
    <Page title={t('nav.profile')} className="max-w-3xl">
      <ProfileWizard standalone={false} />
    </Page>
  );
}
