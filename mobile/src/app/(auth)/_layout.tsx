import React from 'react';
import { Stack } from 'expo-router';
import { usePreferences } from '@/state/preferences';

export default function AuthLayout() {
  const { palette } = usePreferences();
  return <Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:palette.background},animation:'fade'}}/>;
}
