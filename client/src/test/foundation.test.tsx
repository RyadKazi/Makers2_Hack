import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { Providers, routes } from '@/App';
import { defaultsFor, needsFrom, primaryMobility, toggleNeed, uiPreferencesFrom } from '@/features/profile/model';
import i18n from '@/i18n';
import ar from '@/i18n/locales/ar';
import en from '@/i18n/locales/en';
import fr from '@/i18n/locales/fr';
import { applyPreferences, usePreferences } from '@/stores/preferences';
import { tierFor } from '@/lib/hooks';
import { axeViolations } from './axe';

// No server in unit tests: every API call fails fast.
api.defaults.adapter = () => Promise.reject(Object.assign(new Error('offline'), { isAxiosError: true, config: {} }));

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <div id="root">
      <Providers queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>
    </div>,
  );
}

beforeEach(async () => {
  usePreferences.setState({ theme: 'light', motion: 'system', textScale: 1, lang: 'fr', sidebarCollapsed: false, floorId: null });
  await i18n.changeLanguage('fr');
});

describe('preferences on <html>', () => {
  it('applies theme, motion, text scale (up to 200 %), lang and dir', () => {
    const root = document.documentElement;
    applyPreferences({ theme: 'hc', motion: 'reduce', textScale: 2 }, 'ar', root);
    expect(root.dataset.theme).toBe('hc');
    expect(root.dataset.motion).toBe('reduce');
    expect(root.style.fontSize).toBe('200%');
    expect(root.lang).toBe('ar');
    expect(root.dir).toBe('rtl');
    applyPreferences({ theme: 'dark', motion: 'system', textScale: 1 }, 'en', root);
    expect(root.dir).toBe('ltr');
    expect(root.dataset.motion).toBeUndefined();
  });

  it('clamps the text scale between 100 % and 200 %', () => {
    usePreferences.getState().setTextScale(3);
    expect(usePreferences.getState().textScale).toBe(2);
    usePreferences.getState().setTextScale(0.5);
    expect(usePreferences.getState().textScale).toBe(1);
  });
});

describe('i18n', () => {
  const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  it('has the same keys and no empty strings in AR, FR and EN', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
    expect(keys(ar).sort()).toEqual(keys(en).sort());
    for (const locale of [en, fr, ar]) for (const k of keys(locale)) expect(k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], locale)).not.toBe('');
  });
});

describe('profile model', () => {
  it('keeps "none of these" exclusive and picks the most constraining category', () => {
    expect(toggleNeed(['WHEELCHAIR'], 'NONE')).toEqual(['NONE']);
    expect(toggleNeed(['NONE'], 'SPEECH')).toEqual(['SPEECH']);
    expect(primaryMobility(['SPEECH', 'WHEELCHAIR'])).toBe('WHEELCHAIR');
    expect(primaryMobility([])).toBe('NONE');
  });

  it('suggests defaults from the needs', () => {
    const d = defaultsFor(['WHEELCHAIR', 'DEAF_HARD_OF_HEARING']);
    expect(d).toMatchObject({ stepFree: true, requireVerifiedRamps: true, maxSlopePercent: 6, minPassageWidthCm: 85, captions: true, audioGuidance: false });
  });

  it('round-trips a saved profile to needs and UI preferences', () => {
    const profile = { ...defaultsFor(['BLIND_LOW_VISION']), mobility: 'BLIND_LOW_VISION' as const, highContrast: true, reducedMotion: false, textScale: 1.5, updatedAt: '2026-11-20T00:00:00Z' };
    expect(needsFrom(profile)).toEqual(['BLIND_LOW_VISION']);
    expect(uiPreferencesFrom(profile, { theme: 'light' })).toEqual({ theme: 'hc', motion: 'system', textScale: 1.5 });
  });
});

describe('pages: landmarks, headings and axe', () => {
  it.each([
    ['/', /Navigation accessible sur le campus/],
    ['/login', /Connexion/],
    ['/onboarding', /Votre profil d’accessibilité/],
    ['/settings', /Paramètres/],
    ['/design-system', /Design system/],
    ['/more', /Plus/],
    ['/nowhere', /Page introuvable/],
  ])('%s', async (path, title) => {
    const { container } = renderAt(path);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument());
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('link', { name: 'Aller au contenu principal' })).toHaveAttribute('href', '#main');
    expect(document.title).toMatch(/· accesU$/);
    expect(await axeViolations(container, { page: true })).toEqual([]);
  });

  it('public pages render exactly one brand image in the header', () => {
    for (const path of ['/', '/login', '/onboarding']) {
      const { container, unmount } = renderAt(path);
      const images = container.querySelectorAll('header img');
      expect(images).toHaveLength(1);
      expect(images[0]).toHaveAttribute('src', '/brand/accesu-logo-black.jpg');
      unmount();
    }
  });

  it('shell on a phone (390 px): bottom tab bar with 5 sections', async () => {
    window.innerWidth = 390;
    renderAt('/settings');
    const tabs = await screen.findByRole('navigation', { name: 'Sections principales' });
    const links = tabs.querySelectorAll('a');
    expect([...links].map((a) => a.textContent)).toEqual(['Carte', 'Salles', 'Itinéraire', 'Parler', 'Plus']);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    window.innerWidth = 1024;
  });

  it('layout tier follows the effective width (viewport ÷ text scale), like zoom', () => {
    expect(tierFor(1440, 1)).toBe('desktop');
    expect(tierFor(1440, 1.5)).toBe('tablet');
    expect(tierFor(1440, 2)).toBe('mobile');
    expect(tierFor(900, 1)).toBe('tablet');
    expect(tierFor(390, 1)).toBe('mobile');
  });

  it('switches to Arabic with RTL across the app', async () => {
    renderAt('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Paramètres' });
    await i18n.changeLanguage('ar');
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(await screen.findByRole('heading', { level: 1, name: 'الإعدادات' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ar');
  });
});

describe('login form', () => {
  it('validates fields with linked errors and moves focus to the first invalid one', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    renderAt('/login');
    await screen.findByRole('heading', { level: 1, name: 'Connexion' });
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    const email = screen.getByLabelText('Adresse e-mail');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Ce champ est obligatoire.');
    expect(email).toHaveFocus();
  });

  it('shows a network error in an alert when the server is unreachable', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Adresse e-mail'), 'yacine@campusway.local');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
