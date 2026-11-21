import React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { mobilityApi } from '@/api/mobility';
import { useAuth } from '@/state/auth';
import { radii, spacing, usePreferences } from '@/state/preferences';

export function AppScreen({ children, scroll = true, style, contentStyle }: React.PropsWithChildren<{ scroll?: boolean; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle> }>) {
  const { palette } = usePreferences();
  const { status } = useAuth();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }, style]} edges={['top', 'left', 'right']}>
      {status === 'authenticated' ? <SharingBanner /> : null}
      {scroll
        ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, contentStyle]}>{children}</ScrollView>
        : <View style={[styles.content, styles.flex, contentStyle]}>{children}</View>}
    </SafeAreaView>
  );
}

function SharingBanner() {
  const { palette, t, preferences, isRTL } = usePreferences();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['mobility-current', preferences.locale], queryFn: () => mobilityApi.current(preferences.locale), refetchInterval: 45_000, staleTime: 20_000 });
  const stop = useMutation({
    mutationFn: async () => {
      const id = status.data?.session?.id;
      if (!id) throw new Error('No active session');
      return mobilityApi.stop(id, preferences.locale);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobility-current'] }),
  });
  if (status.data?.state !== 'ACTIVE' || !status.data.session) return null;
  const onStop = () => Alert.alert(t('stopSharing'), t('stopSharing'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('stopSharing'), style: 'destructive', onPress: () => stop.mutate() },
  ]);
  return (
    <View accessibilityRole="summary" style={[styles.sharingBanner, { backgroundColor: palette.primary }]}>
      <MaterialCommunityIcons name="record-circle-outline" size={20} color={palette.accent} />
      <Pressable accessibilityRole="button" accessibilityLabel={t('sharingOn')} onPress={() => router.push('/sharing')} style={styles.bannerLabel}>
        <Text style={[styles.bannerText, { color: palette.primaryText }]}>{t('sharingOn')} · {new Date(status.data.session.autoStopAt).toLocaleTimeString(preferences.locale, { hour: '2-digit', minute: '2-digit' })}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('stopSharing')} accessibilityState={{ busy: stop.isPending }} disabled={stop.isPending} onPress={onStop} hitSlop={8} style={[styles.bannerStop, isRTL && styles.rtlRow]}>
        <Text style={[styles.bannerStopText, { color: palette.accent }]}>{stop.isPending ? t('loading') : t('stopSharing')}</Text>
      </Pressable>
    </View>
  );
}

export function BrandMark({ size = 52 }: { size?: number }) {
  const { palette } = usePreferences();
  return <View accessibilityElementsHidden style={[styles.brandMark, { width: size, height: size, borderRadius: size * 0.34, backgroundColor: palette.primary }]}>
    <MaterialCommunityIcons name="map-marker-path" size={size * 0.52} color={palette.accent} />
  </View>;
}

export function AppText({ children, size = 16, weight = 'regular', color, style, accessibilityRole, accessibilityLabel, numberOfLines }: React.PropsWithChildren<{
  size?: number; weight?: 'regular' | 'medium' | 'semibold' | 'bold'; color?: string;
  style?: StyleProp<TextStyle>; accessibilityRole?: 'header' | 'text' | 'link' | 'summary'; accessibilityLabel?: string; numberOfLines?: number;
}>) {
  const { palette, preferences, isRTL } = usePreferences();
  const fontWeight = weight === 'regular' ? '400' : weight === 'medium' ? '500' : weight === 'semibold' ? '600' : '700';
  return <Text accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} numberOfLines={numberOfLines} maxFontSizeMultiplier={1.6}
    style={[{ color: color ?? palette.text, fontSize: size * preferences.textScale, fontWeight, lineHeight: size * preferences.textScale * 1.42 }, isRTL && styles.rtlText, style]}>{children}</Text>;
}

export function PageHeading({ title, eyebrow, subtitle, trailing }: { title: string; eyebrow?: string; subtitle?: string; trailing?: React.ReactNode }) {
  const { palette, isRTL } = usePreferences();
  return <View style={[styles.heading, isRTL && styles.rtlRow]}>
    <View style={styles.headingText}>
      {eyebrow ? <AppText size={12} weight="bold" color={palette.primary}>{eyebrow}</AppText> : null}
      <AppText size={29} weight="bold" accessibilityRole="header" style={styles.headingTitle}>{title}</AppText>
      {subtitle ? <AppText color={palette.muted}>{subtitle}</AppText> : null}
    </View>
    {trailing}
  </View>;
}

export function Card({ children, style, ...props }: React.PropsWithChildren<ViewProps>) {
  const { palette } = usePreferences();
  return <View {...props} style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: palette.borderWidth, shadowColor: palette.shadow }, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false, icon, style, accessibilityHint }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  disabled?: boolean; loading?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle>; accessibilityHint?: string;
}) {
  const { palette } = usePreferences();
  const background = variant === 'primary' ? palette.accent : variant === 'danger' ? palette.danger : variant === 'secondary' ? palette.soft : variant === 'ghost' ? 'transparent' : palette.surface;
  const foreground = variant === 'primary' ? palette.accentText : variant === 'danger' ? '#FFFFFF' : palette.text;
  const border = variant === 'outline' ? palette.border : 'transparent';
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={accessibilityHint} accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: border, opacity: disabled ? 0.52 : pressed ? 0.88 : 1 }, style]}>
    {loading ? <ActivityIndicator color={foreground} /> : <>{icon}<Text style={[styles.buttonText, { color: foreground }]}>{title}</Text></>}
  </Pressable>;
}

export function IconButton({ icon, label, onPress, disabled = false, tone = 'default' }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; onPress: () => void; disabled?: boolean; tone?: 'default' | 'accent' }) {
  const { palette } = usePreferences();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.iconButton, { backgroundColor: tone === 'accent' ? palette.accent : palette.surfaceRaised, borderColor: palette.border, opacity: pressed ? 0.82 : 1 }]}>
    <MaterialCommunityIcons name={icon} size={21} color={tone === 'accent' ? palette.accentText : palette.primary} />
  </Pressable>;
}

export function TextField({ label, error, style, inputStyle, ...props }: TextInputProps & { label: string; error?: string; inputStyle?: StyleProp<TextStyle> }) {
  const { palette, isRTL } = usePreferences();
  return <View style={[styles.field, style]}>
    <AppText size={14} weight="semibold">{label}</AppText>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={palette.muted} maxFontSizeMultiplier={1.6}
      style={[styles.input, { backgroundColor: palette.surface, borderColor: error ? palette.danger : palette.border, color: palette.text, textAlign: isRTL ? 'right' : 'left' }, inputStyle]} />
    {error ? <AppText size={13} color={palette.danger}>{error}</AppText> : null}
  </View>;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { palette, isRTL } = usePreferences();
  return <View style={[styles.sectionTitle, isRTL && styles.rtlRow]}>
    <AppText size={18} weight="bold" accessibilityRole="header">{title}</AppText>
    {action ? <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onAction} hitSlop={8}><AppText size={14} weight="semibold" color={palette.primary}>{action}</AppText></Pressable> : null}
  </View>;
}

export function Chip({ label, selected = false, onPress, disabled = false, icon }: { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean; icon?: React.ReactNode }) {
  const { palette } = usePreferences();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.chip, { backgroundColor: selected ? palette.accent : palette.surface, borderColor: selected ? palette.accent : palette.border, opacity: pressed ? 0.86 : 1 }]}>
    {icon}{<AppText size={13} weight="semibold" color={selected ? palette.accentText : palette.text}>{label}</AppText>}
  </Pressable>;
}

export function SwitchRow({ title, description, value, onValueChange, disabled = false }: { title: string; description?: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  const { palette, isRTL } = usePreferences();
  return <View style={[styles.switchRow, isRTL && styles.rtlRow]}>
    <View style={styles.switchText}><AppText weight="semibold">{title}</AppText>{description ? <AppText size={13} color={palette.muted}>{description}</AppText> : null}</View>
    <Switch accessibilityLabel={title} value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ false: palette.border, true: palette.accent }} thumbColor="#FFFFFF" />
  </View>;
}

export function InlineNotice({ children, tone = 'info' }: React.PropsWithChildren<{ tone?: 'info' | 'warning' | 'success' | 'danger' }>) {
  const { palette } = usePreferences();
  const color = tone === 'warning' ? palette.warning : tone === 'success' ? palette.success : tone === 'danger' ? palette.danger : palette.primary;
  return (
    <View accessibilityRole="summary" style={[styles.notice, { backgroundColor: palette.surface, borderColor: color }]}>
      <MaterialCommunityIcons
        name={tone === 'danger' ? 'alert-circle-outline' : tone === 'warning' ? 'alert-outline' : tone === 'success' ? 'check-circle-outline' : 'information-outline'}
        size={20}
        color={color}
      />
      <View style={styles.flex}>
        {React.isValidElement(children) && typeof children.type !== 'string' ? (
          children
        ) : (
          <AppText size={14}>{children}</AppText>
        )}
      </View>
    </View>
  );
}

export function LoadingState({ label }: { label: string }) {
  const { palette } = usePreferences();
  return <View accessibilityRole="progressbar" style={styles.state}><ActivityIndicator color={palette.accent} size="large" /><AppText color={palette.muted}>{label}</AppText></View>;
}
export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel: string }) {
  const { palette } = usePreferences();
  return <Card style={styles.errorCard}><AppText weight="semibold" color={palette.danger}>{message}</AppText>{onRetry ? <Button title={retryLabel} onPress={onRetry} variant="outline" /> : null}</Card>;
}
export function EmptyState({ title, detail, icon }: { title: string; detail: string; icon?: React.ReactNode }) {
  const { palette } = usePreferences();
  return <Card style={styles.empty}>{icon}<AppText size={18} weight="bold">{title}</AppText><AppText color={palette.muted}>{detail}</AppText></Card>;
}

export const rowDirection = (rtl: boolean) => ({ flexDirection: (rtl ? 'row-reverse' : 'row') as 'row' | 'row-reverse' });

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg }, flex: { flex: 1 },
  heading: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, headingText: { flex: 1, gap: 4 }, headingTitle: { letterSpacing: -0.6 },
  card: { borderWidth: 1, borderRadius: radii.card, padding: spacing.md, gap: spacing.sm, shadowOpacity: 0.055, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  button: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radii.control, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs }, buttonText: { fontSize: 15, fontWeight: '700' },
  iconButton: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 7 }, input: { minHeight: 52, borderWidth: 1, borderRadius: radii.control, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, fontSize: 16 },
  sectionTitle: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  chip: { minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radii.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  switchRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, switchText: { flex: 1, gap: 4 },
  notice: { padding: 14, borderWidth: 1, borderRadius: 17, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, state: { paddingVertical: 30, alignItems: 'center', gap: 12 },
  errorCard: { gap: 12 }, empty: { alignItems: 'center', paddingVertical: 28, gap: 12 }, rtlText: { writingDirection: 'rtl' }, rtlRow: { flexDirection: 'row-reverse' },
  sharingBanner: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9 }, bannerLabel: { flex: 1 }, bannerText: { fontSize: 12, fontWeight: '700' }, bannerStop: { minHeight: 36, paddingHorizontal: 8, justifyContent: 'center' }, bannerStopText: { fontSize: 12, fontWeight: '800' }, brandMark: { alignItems: 'center', justifyContent: 'center' },
});
