import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { AppScreen, LoadingState } from '@/components/ui';
import { useAuth } from '@/state/auth';
import { usePreferences } from '@/state/preferences';

export default function AuthLayout() {
  const { palette, t } = usePreferences();
  const { status } = useAuth();
  if (status === 'loading') return <AppScreen><LoadingState label={t('loading')} /></AppScreen>;
  if (status === 'authenticated') return <Redirect href="/(tabs)/map" />;
  return <Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:palette.background},animation:'fade'}}/>;
}
