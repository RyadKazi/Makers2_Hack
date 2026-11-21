import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/state/auth';
import { usePreferences } from '@/state/preferences';

export default function Index() {
  const { status } = useAuth();
  const { ready, palette } = usePreferences();
  if (!ready || status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }
  return <Redirect href={status === 'authenticated' ? '/(tabs)/map' : '/(auth)/welcome'} />;
}
