import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AnnouncerProvider } from '@/a11y/Announcer';
import { refreshSession } from '@/api/client';
import { ToastProvider } from '@/components/ui/Toast';
import { AppShell } from '@/components/shell/AppShell';
import { uiPreferencesFrom } from '@/features/profile/model';
import { MapPage } from '@/features/map/MapPage';
import { NavigatePage } from '@/features/navigate/NavigatePage';
import { RoomsPage } from '@/features/rooms/RoomsPage';
import { DesignSystemPage } from '@/pages/DesignSystemPage';
import { AdminPage } from '@/pages/AdminPage';
import { TalkPage } from '@/pages/TalkPage';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingPage, ProfilePage } from '@/pages/OnboardingPage';
import { MorePage, NotFoundPage } from '@/pages/PlaceholderPages';
import { SettingsPage } from '@/pages/SettingsPage';
import { SocketProvider } from '@/realtime/SocketProvider';
import { useAuth } from '@/stores/auth';
import { applyPreferences, usePreferences, watchSystemPreferences, type Lang } from '@/stores/preferences';

export const routes = [
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/onboarding', element: <OnboardingPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/map', element: <MapPage /> },
      { path: '/rooms', element: <RoomsPage /> },
      { path: '/navigate', element: <NavigatePage /> },
      { path: '/talk', element: <TalkPage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/more', element: <MorePage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/design-system', element: <DesignSystemPage /> },
      { path: '/home', element: <Navigate to="/map" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

/** Keeps <html> (theme, motion, text scale, lang, dir) in sync with the preferences. */
function PreferencesSync() {
  const { i18n } = useTranslation();
  const prefs = usePreferences();
  useEffect(() => {
    const apply = () => applyPreferences(usePreferences.getState(), i18n.language as Lang);
    apply();
    return watchSystemPreferences(apply);
  }, [prefs.theme, prefs.motion, prefs.textScale, i18n.language]);
  return null;
}

/** Restores the session from the refresh cookie, then applies the saved profile once. */
function SessionBootstrap() {
  const user = useAuth((s) => s.user);
  const { i18n } = useTranslation();
  useEffect(() => {
    void refreshSession();
  }, []);
  useEffect(() => {
    if (!user) return;
    const prefs = usePreferences.getState();
    if (!prefs.lang && user.locale !== i18n.language) void i18n.changeLanguage(user.locale);
    if (user.accessibilityProfile.updatedAt) {
      const ui = uiPreferencesFrom(user.accessibilityProfile, { theme: prefs.theme });
      usePreferences.setState({ theme: ui.theme, motion: ui.motion, textScale: ui.textScale });
    }
    // Apply once per signed-in user, not on every profile edit (the wizard previews live).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  return null;
}

export function Providers({ children, queryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const client = queryClient ?? defaultQueryClient;
  return (
    <QueryClientProvider client={client}>
      <AnnouncerProvider>
        <ToastProvider>
          <PreferencesSync />
          {children}
        </ToastProvider>
      </AnnouncerProvider>
    </QueryClientProvider>
  );
}

const defaultQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter(routes);

export function App() {
  return (
    <Providers>
      <SessionBootstrap />
      <SocketProvider>
        <RouterProvider router={router} />
      </SocketProvider>
    </Providers>
  );
}
