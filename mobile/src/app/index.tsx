import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { usePreferences } from '@/state/preferences';

export default function Index() {
  const { ready, palette } = usePreferences();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }
  // With auth disabled, redirect straight into the campus map tab
  return <Redirect href="/(tabs)/map" />;
}
