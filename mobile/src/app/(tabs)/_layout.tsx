import React from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePreferences } from '@/state/preferences';

export default function TabLayout() {
  const { palette, t } = usePreferences();

  const iconColor = (color: unknown) => (typeof color === 'string' ? color : palette.muted);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          height: 72,
          paddingTop: 8,
          paddingBottom: 8,
          backgroundColor: palette.card,
          borderTopColor: palette.line,
          borderTopWidth: 1,
          elevation: 8,
        },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
        tabBarItemStyle: {
          minHeight: 52,
          borderRadius: 14,
          marginHorizontal: 2,
        },
        tabBarHideOnKeyboard: true,
      }}>
      {/* 1. Map Tab */}
      <Tabs.Screen
        name="map"
        options={{
          title: t('map'),
          tabBarAccessibilityLabel: t('map'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="map-outline" size={size} color={iconColor(color)} />
          ),
        }}
      />

      {/* 2. Rooms Tab */}
      <Tabs.Screen
        name="rooms"
        options={{
          title: t('rooms'),
          tabBarAccessibilityLabel: t('rooms'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="door-open" size={size} color={iconColor(color)} />
          ),
        }}
      />

      {/* 3. Navigate Tab */}
      <Tabs.Screen
        name="navigate"
        options={{
          title: t('navigate'),
          tabBarAccessibilityLabel: t('navigate'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="navigation-variant-outline" size={size} color={iconColor(color)} />
          ),
        }}
      />

      {/* 4. Talk Tab */}
      <Tabs.Screen
        name="talk"
        options={{
          title: t('talk'),
          tabBarAccessibilityLabel: t('talk'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="account-voice" size={size} color={iconColor(color)} />
          ),
        }}
      />

      {/* 5. More Tab */}
      <Tabs.Screen
        name="more"
        options={{
          title: t('more'),
          tabBarAccessibilityLabel: t('more'),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="dots-horizontal-circle-outline" size={size} color={iconColor(color)} />
          ),
        }}
      />

      {/* Hidden redirect helper and legacy routes */}
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="tools" options={{ href: null }} />
    </Tabs>
  );
}
