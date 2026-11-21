import { Contrast, LogIn, LogOut, Moon, Pencil, Sun, SunMoon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useLogout } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { RadioGroup, RangeField } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';
import { LanguageSelect } from '@/components/shell/Controls';
import { Page } from '@/components/shell/Page';
import { useAuth } from '@/stores/auth';
import { TEXT_SCALE, usePreferences, type MotionChoice, type ThemeChoice } from '@/stores/preferences';

const linkButton = 'inline-flex min-h-12 items-center gap-2 rounded-control px-5 font-bold transition-colors duration-fast';

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const prefs = usePreferences();
  const user = useAuth((s) => s.user);
  const logout = useLogout();

  const signOut = (everywhere: boolean) =>
    logout.mutate(everywhere, {
      onSettled: () => {
        toast.show(t('settings.signedOut'), { tone: 'success' });
        navigate('/');
      },
    });

  return (
    <Page title={t('settings.title')} className="max-w-3xl">
      <div className="flex flex-col gap-4">
        <Card aria-labelledby="set-appearance">
          <CardHeader title={t('settings.appearance')} titleId="set-appearance" />
          <div className="flex flex-col gap-6">
            <RadioGroup<ThemeChoice>
              legend={t('settings.theme')}
              name="theme"
              value={prefs.theme}
              onChange={prefs.setTheme}
              options={[
                { value: 'system', label: t('theme.system'), icon: SunMoon },
                { value: 'light', label: t('theme.light'), icon: Sun },
                { value: 'dark', label: t('theme.dark'), icon: Moon },
                { value: 'hc', label: t('theme.hc'), icon: Contrast },
              ]}
            />
            <RangeField
              label={t('settings.textSize')}
              hint={t('settings.textSizeHint')}
              value={prefs.textScale}
              min={TEXT_SCALE.min}
              max={TEXT_SCALE.max}
              step={TEXT_SCALE.step}
              onChange={prefs.setTextScale}
              format={(v) => t('settings.textSizeValue', { value: Math.round(v * 100) })}
            />
            <RadioGroup<MotionChoice>
              legend={t('settings.motion')}
              name="motion"
              value={prefs.motion}
              onChange={prefs.setMotion}
              options={[
                { value: 'system', label: t('settings.motionSystem') },
                { value: 'reduce', label: t('settings.motionReduce') },
                { value: 'full', label: t('settings.motionFull') },
              ]}
            />
            <div className="max-w-xs">
              <p className="mb-2 text-base font-bold text-ink">{t('settings.language')}</p>
              <LanguageSelect compact />
            </div>
          </div>
        </Card>

        <Card aria-labelledby="set-a11y">
          <CardHeader title={t('settings.accessibility')} titleId="set-a11y" />
          <p className="mb-4 text-base text-muted">{t('settings.accessibilityText')}</p>
          <Link to="/profile" className={`${linkButton} bg-primary text-on-primary hover:bg-primary-800`}>
            <Pencil aria-hidden className="size-5" />
            {t('settings.editProfile')}
          </Link>
        </Card>

        <Card aria-labelledby="set-privacy">
          <CardHeader title={t('settings.privacy')} titleId="set-privacy" />
          <p className="text-base text-muted">{t('settings.privacyText')}</p>
        </Card>

        <Card aria-labelledby="set-account">
          <CardHeader title={t('settings.account')} titleId="set-account" />
          {user ? (
            <>
              <p className="mb-4 text-base text-ink">{t('settings.signedInAs', { email: user.email })}</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" icon={LogOut} onClick={() => signOut(false)}>
                  {t('settings.signOut')}
                </Button>
                <Button variant="danger-outline" icon={LogOut} onClick={() => signOut(true)}>
                  {t('settings.signOutAll')}
                </Button>
              </div>
            </>
          ) : (
            <Link to="/login" className={`${linkButton} border-control bg-surface-2 text-ink`}>
              <LogIn aria-hidden className="size-5 flip-rtl" />
              {t('topbar.signIn')}
            </Link>
          )}
        </Card>
      </div>
    </Page>
  );
}
