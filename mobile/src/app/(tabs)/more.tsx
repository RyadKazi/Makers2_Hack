import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, InlineNotice, PageHeading, SectionTitle, SwitchRow } from '@/components/ui';
import { useAuth } from '@/state/auth';
import { usePreferences, type ThemeMode } from '@/state/preferences';

const DEMO_USERS = [
  { role: 'STUDENT', email: 'student@campusway.local', name: 'Yacine (Étudiant PMR)', mobility: 'WHEELCHAIR' },
  { role: 'TEACHER', email: 'benali@campusway.local', name: 'Dr. Benali (Enseignant)', mobility: 'NONE' },
  { role: 'ADMIN', email: 'admin@campusway.local', name: 'Admin Campusway', mobility: 'NONE' },
  { role: 'CLUB', email: 'riad@campusway.local', name: 'Riad (Club GDG)', mobility: 'NONE' },
];

const MOCK_HOTSPOTS = [
  { id: 'h-1', title: 'Porte d’accès Hall B bloquée', level: 'RDC Bâtiment B', type: 'BLOCKED', votes: 8 },
  { id: 'h-2', title: 'Pente d’accès supérieure à 8%', level: 'Parvis Central', type: 'TOO_STEEP', votes: 14 },
  { id: 'h-3', title: 'Travaux couloir TD - contournement conseillé', level: 'Étage 1 Pôle Info', type: 'HARD_TO_NAVIGATE', votes: 6 },
];

export default function MoreScreen() {
  const { t, palette, preferences, setPreference, isRTL } = usePreferences();
  const { user, setDemoUser, isAuthDisabled } = useAuth();
  const [showAdminSection, setShowAdminSection] = useState(user?.role === 'ADMIN');

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

        {isAuthDisabled ? (
          <InlineNotice tone="info">
            {t('authDisabledBadge')} · Toutes les fonctionnalités sont immédiatement déverrouillées.
          </InlineNotice>
        ) : null}

        {/* Quick Demo Switcher */}
        <View style={{ gap: 8, marginTop: 4 }}>
          <AppText size={13} weight="semibold" color={palette.muted}>{t('demoAccounts')}</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {DEMO_USERS.map(u => (
              <Chip
                key={u.email}
                label={u.name}
                selected={user?.email === u.email}
                onPress={() => {
                  setDemoUser({
                    email: u.email,
                    displayName: u.name,
                    role: u.role as any,
                  });
                  if (u.role === 'ADMIN') setShowAdminSection(true);
                }}
              />
            ))}
          </ScrollView>
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

      {/* Admin Mobility Dashboard */}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionTitle title={t('adminHub')} />
          <Pressable onPress={() => setShowAdminSection(!showAdminSection)}>
            <AppText size={13} weight="bold" color={palette.primary}>
              {showAdminSection ? 'Masquer' : 'Afficher'}
            </AppText>
          </Pressable>
        </View>

        {showAdminSection ? (
          <View style={{ gap: 12 }}>
            <View style={styles.kpiGrid}>
              <View style={[styles.kpiCard, { backgroundColor: palette.surface2 }]}>
                <AppText size={22} weight="bold" color={palette.primary}>142</AppText>
                <AppText size={11} color={palette.muted}>Trajets PMR ce mois</AppText>
              </View>
              <View style={[styles.kpiCard, { backgroundColor: palette.surface2 }]}>
                <AppText size={22} weight="bold" color={palette.available}>98%</AppText>
                <AppText size={11} color={palette.muted}>Rampes vérifiées</AppText>
              </View>
              <View style={[styles.kpiCard, { backgroundColor: palette.surface2 }]}>
                <AppText size={22} weight="bold" color={palette.danger}>3</AppText>
                <AppText size={11} color={palette.muted}>Obstacles en cours</AppText>
              </View>
            </View>

            <AppText size={14} weight="bold">{t('hotspots')}</AppText>
            {MOCK_HOTSPOTS.map(h => (
              <View key={h.id} style={[styles.hotspotItem, { borderColor: palette.line, backgroundColor: palette.surface2 }]}>
                <MaterialCommunityIcons
                  name={h.type === 'BLOCKED' ? 'alert-octagon' : 'slope-uphill'}
                  size={20}
                  color={h.type === 'BLOCKED' ? palette.danger : palette.warning}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText size={14} weight="semibold">{h.title}</AppText>
                  <AppText size={12} color={palette.muted}>{h.level} · {h.votes} signalements</AppText>
                </View>
                <Button
                  title="Résolu"
                  variant="outline"
                  style={{ minHeight: 34, paddingHorizontal: 10 }}
                  onPress={() => Alert.alert('Obstacle mis à jour', 'Le statut a été mis à jour dans la base.')}
                />
              </View>
            ))}
          </View>
        ) : (
          <AppText size={13} color={palette.muted}>
            Statistiques de mobilité, détection des goulots d’étranglement et revue des obstacles.
          </AppText>
        )}
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
