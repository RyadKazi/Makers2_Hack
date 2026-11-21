/** Top-bar controls: theme, language, floor selector and the account menu. */
import { Building2, Contrast, Languages, LogIn, LogOut, Moon, Settings, Sparkles, Sun, SunMoon, UserRound, Accessibility } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAnnounce } from '@/a11y/Announcer';
import { useBuildings, useLogout } from '@/api/hooks';
import { IconButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { LANGUAGE_NAMES } from '@/i18n';
import { cn } from '@/lib/cn';
import { floorLabel } from '@/lib/floors';
import { useAuth } from '@/stores/auth';
import { LANGS, usePreferences, type Lang, type ThemeChoice } from '@/stores/preferences';

const THEME_ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark', 'hc'];
const THEME_ICON = { warm: Sparkles, system: SunMoon, light: Sun, dark: Moon, hc: Contrast } as const;

export function ThemeButton() {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const theme = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  const name = t(`theme.${theme}`);
  return (
    <IconButton
      icon={THEME_ICON[theme]}
      label={t('theme.cycle', { name })}
      onClick={() => {
        const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]!;
        setTheme(next);
        announce(t('theme.changed', { name: t(`theme.${next}`) }));
      }}
    />
  );
}

export function LanguageSelect({ compact = false, narrow = false }: { compact?: boolean; narrow?: boolean }) {
  const { t, i18n } = useTranslation();
  const setLang = usePreferences((s) => s.setLang);
  return (
    <Select
      label={t('topbar.language')}
      hideLabel
      pill
      {...(narrow ? {} : { icon: Languages })}
      value={i18n.language}
      onChange={(e) => {
        const lang = e.target.value as Lang;
        setLang(lang);
        void i18n.changeLanguage(lang);
      }}
      className={compact ? 'w-full' : narrow ? 'w-32 tablet:w-40' : 'w-40'}
    >
      {LANGS.map((l) => (
        <option key={l} value={l} lang={l}>
          {LANGUAGE_NAMES[l]}
        </option>
      ))}
    </Select>
  );
}

export function FloorSelect({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { data, isError } = useBuildings();
  const floorId = usePreferences((s) => s.floorId);
  const setFloorId = usePreferences((s) => s.setFloorId);
  const buildings = data?.items ?? [];
  const first = buildings[0]?.floors[0]?.id ?? '';

  useEffect(() => {
    if (!floorId && first) setFloorId(first);
  }, [floorId, first, setFloorId]);

  return (
    <Select
      label={t('topbar.floor')}
      hideLabel
      pill
      icon={Building2}
      value={floorId ?? ''}
      disabled={isError || buildings.length === 0}
      onChange={(e) => setFloorId(e.target.value)}
      className={cn('w-64', className)}
    >
      {buildings.length === 0 ? <option value="">{t('topbar.noFloors')}</option> : null}
      {buildings.map((b) => (
        <optgroup key={b.id} label={i18n.language === 'ar' ? b.nameAr : b.name}>
          {b.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {`${i18n.language === 'ar' ? b.nameAr : b.name} · ${floorLabel(f.level, t)}`}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w[0] ?? ''))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Disclosure (button + list of links), simpler and more robust than an ARIA menu. */
export function ProfileMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const name = user?.displayName ?? t('topbar.guest');

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-start text-base text-ink hover:bg-surface-2';
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-menu"
        aria-label={t('topbar.profileMenu', { name })}
        onClick={() => setOpen((o) => !o)}
        className="flex size-12 items-center justify-center rounded-full"
      >
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-primary-50 text-base font-bold text-primary hc:border-2 hc:border-white">
          {user ? initials(name) : <UserRound className="size-5" />}
        </span>
      </button>
      {open ? (
        <div id="profile-menu" className="absolute end-0 top-14 z-overlay w-72 rounded-control border border-line bg-card p-2 shadow-card">
          <p className="px-3 py-2 text-sm text-muted">{user ? user.email : t('topbar.guest')}</p>
          <ul>
            <li>
              <Link to="/settings" className={item} onClick={() => setOpen(false)}>
                <Settings aria-hidden className="size-5" />
                {t('nav.settings')}
              </Link>
            </li>
            <li>
              <Link to="/profile" className={item} onClick={() => setOpen(false)}>
                <Accessibility aria-hidden className="size-5" />
                {t('nav.profile')}
              </Link>
            </li>
            <li>
              {user ? (
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    setOpen(false);
                    logout.mutate(false, { onSettled: () => navigate('/') });
                  }}
                >
                  <LogOut aria-hidden className="size-5 flip-rtl" />
                  {t('topbar.signOut')}
                </button>
              ) : (
                <Link to="/login" className={item} onClick={() => setOpen(false)}>
                  <LogIn aria-hidden className="size-5 flip-rtl" />
                  {t('topbar.signIn')}
                </Link>
              )}
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
