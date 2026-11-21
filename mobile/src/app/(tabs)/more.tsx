import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, PageHeading, SectionTitle, SwitchRow } from '@/components/ui';
import { useAuth } from '@/state/auth';
import { usePreferences, type ThemeMode } from '@/state/preferences';

export default function MoreScreen() {
  const { t, palette, preferences, setPreference, isRTL } = usePreferences();
  const { user } = useAuth();

  const isRTLRow = isRTL ? 'row-reverse' : 'row';

  return (
    <AppScreen>
      <PageHeading
        eyebrow="CAMPUSWAY"
        title={t('more')}
        subtitle={preferences.locale === 'fr' ? 'Préférences, accessibilité, outils avancés et administration' : 'Settings, accessibility profile, advanced tools and admin'}
      />

      {/* Auth Status & Current User Card */}
      <Card style={{ gap: 12 }}>
        <View style={[styles.userRow, { flexDirection: isRTLRow }]}>
          <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
            <MaterialCommunityIcons name="account-circle" size={32} color={palette.onPrimary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppText size={17} weight="bold">{user?.displayName || 'Utilisateur invité'}</AppText>
              <View style={[styles.roleBadge, { backgroundColor: palette.surface2 }]}>
                <AppText size={11} weight="bold" color={palette.primary}>{user?.role || 'GUEST'}</AppText>
              </View>
            </View>
            <AppText size={13} color={palette.muted}>{user?.email || 'Accès libre sans authentification'}</AppText>
          </View>
        </View>




      </Card>

      {/* Appearance Settings */}
      <Card style={{ gap: 12 }}>
        <SectionTitle title={t('appearance')} />

        {/* Theme Mode Chips */}
        <View style={{ gap: 6 }}>
          <AppText size={14} weight="semibold">{t('appearance')}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['warm', 'light', 'dark', 'hc', 'system'] as ThemeMode[]).map(mode => (
              <Chip
                key={mode}
                label={t(mode as any)}
                selected={preferences.theme === mode}
                onPress={() => void setPreference('theme', mode)}
              />
            ))}
          </View>
        </View>

        {/* High Contrast & Reduced Motion */}
        <SwitchRow
          title={t('highContrast')}
          description="Bordures 2px renforcées et contrastes maximisés"
          value={preferences.highContrast}
          onValueChange={val => void setPreference('highContrast', val)}
        />

        <SwitchRow
          title={t('reducedMotion')}
          description="Désactive les animations pour le confort visuel"
          value={preferences.reducedMotion}
          onValueChange={val => void setPreference('reducedMotion', val)}
        />

        {/* Text Scale Stepper */}
        <View style={[styles.stepperRow, { flexDirection: isRTLRow }]}>
          <View style={{ flex: 1 }}>
            <AppText weight="semibold">{t('largerText')}</AppText>
            <AppText size={13} color={palette.muted}>{preferences.textScale.toFixed(2)}×</AppText>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              title="−"
              variant="outline"
              style={{ minHeight: 40, minWidth: 44 }}
              onPress={() => {
                const next = Math.max(1.0, Math.round((preferences.textScale - 0.25) * 100) / 100);
                void setPreference('textScale', next);
              }}
            />
            <Button
              title="+"
              variant="outline"
              style={{ minHeight: 40, minWidth: 44 }}
              onPress={() => {
                const next = Math.min(2.0, Math.round((preferences.textScale + 0.25) * 100) / 100);
                void setPreference('textScale', next);
              }}
            />
          </View>
        </View>
      </Card>

      {/* Language Selection */}
      <Card style={{ gap: 10 }}>
        <SectionTitle title={t('appLanguage')} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { id: 'fr', label: 'Français' },
            { id: 'en', label: 'English' },
            { id: 'ar', label: 'العربية' },
          ].map(l => (
            <Chip
              key={l.id}
              label={l.label}
              selected={preferences.locale === l.id}
              onPress={() => void setPreference('locale', l.id as any)}
            />
          ))}
        </View>
      </Card>

      {/* Quick Navigation Links */}
      <Card style={{ gap: 8 }}>
        <SectionTitle title="Raccourcis & Profil" />

        <Pressable
          style={[styles.menuRow, { borderBottomColor: palette.line }]}
          onPress={() => router.push('/accessibility-settings')}>
          <MaterialCommunityIcons name="wheelchair-accessibility" size={22} color={palette.primary} />
          <View style={{ flex: 1 }}>
            <AppText size={15} weight="semibold">{t('preferences')}</AppText>
            <AppText size={12} color={palette.muted}>Besoins spécifiques, rampes, guidage sonore</AppText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={palette.muted} />
        </Pressable>

        <Pressable
          style={[styles.menuRow, { borderBottomColor: palette.line }]}
          onPress={() => router.push('/report-obstacle')}>
          <MaterialCommunityIcons name="alert-circle-outline" size={22} color={palette.warning} />
          <View style={{ flex: 1 }}>
            <AppText size={15} weight="semibold">{t('reportObstacle')}</AppText>
            <AppText size={12} color={palette.muted}>Signaler un passage bloqué ou un obstacle</AppText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={palette.muted} />
        </Pressable>

        <Pressable
          style={[styles.menuRow, { borderBottomColor: palette.line }]}
          onPress={() => router.push('/sharing')}>
          <MaterialCommunityIcons name="share-variant-outline" size={22} color={palette.primary} />
          <View style={{ flex: 1 }}>
            <AppText size={15} weight="semibold">{t('privacy')}</AppText>
            <AppText size={12} color={palette.muted}>Partage solidaire de données de mobilité</AppText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={palette.muted} />
        </Pressable>
      </Card>


    </AppScreen>
  );
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 14,
    borderBottomWidth: 1,
  },
  kpiGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  hotspotItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
});
