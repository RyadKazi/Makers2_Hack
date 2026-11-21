import 'react-native-reanimated';
import React from 'react';
import { useColorScheme } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/state/auth';
import { PreferencesProvider, usePreferences } from '@/state/preferences';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }, mutations: { retry: 0 } } });

function AppRoutes() {
  const { palette, preferences } = usePreferences();
  const systemScheme = useColorScheme();
  const isDark = preferences.theme === 'dark' || (preferences.theme === 'system' && systemScheme === 'dark');
  const useLightStatusBar = preferences.theme === 'hc' || preferences.highContrast || isDark;
  return <>
    <StatusBar style={useLightStatusBar ? 'light' : 'dark'} />
    <Stack screenOptions={{ headerShown:false, contentStyle:{backgroundColor:palette.background}, animation:preferences.reducedMotion?'none':'fade' }}>
      <Stack.Screen name="index"/>
      <Stack.Screen name="(auth)"/>
      <Stack.Screen name="(tabs)"/>
      <Stack.Screen name="accessibility-settings" options={{presentation:'modal',headerShown:false}}/>
      <Stack.Screen name="sharing" options={{presentation:'modal',headerShown:false}}/>
      <Stack.Screen name="report-obstacle" options={{presentation:'modal',headerShown:false}}/>
    </Stack>
  </>;
}

export default function RootLayout() {
  return <GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><QueryClientProvider client={queryClient}><PreferencesProvider><AuthProvider><AppRoutes/></AuthProvider></PreferencesProvider></QueryClientProvider></SafeAreaProvider></GestureHandlerRootView>;
}
