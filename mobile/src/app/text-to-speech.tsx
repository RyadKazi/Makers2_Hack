import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, InlineNotice, PageHeading } from '@/components/ui';
import { usePreferences } from '@/state/preferences';
import { textToSpeechService, type PreviewHandle } from '@/services/speech/tts';
import type { Locale } from '@/types/api';

const samples: Record<Locale, string[]> = {
  en: ['Could you please repeat that?', 'I need a little more time.', 'Thank you for your help.'],
  fr: ['Pouvez-vous répéter, s’il vous plaît ?', 'J’ai besoin d’un peu plus de temps.', 'Merci pour votre aide.'],
  ar: ['هل يمكنك إعادة ذلك من فضلك؟', 'أحتاج إلى مزيد من الوقت.', 'شكراً على مساعدتك.'],
};
const langs: Locale[] = ['en', 'fr', 'ar'];

export default function TextToSpeechScreen() {
  const { t, palette, preferences, isRTL, setPreference } = usePreferences();
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const handle = useRef<PreviewHandle | null>(null);

  useEffect(() => () => handle.current?.stop(), []);

  const play = () => {
    if (!text.trim()) return;
    handle.current?.stop();
    setPlaying(true);
    setPaused(false);
    handle.current = textToSpeechService.createPreview(
      text,
      { locale: preferences.locale, speed },
      () => {
        setPlaying(false);
        setPaused(false);
      }
    );
  };

  const pause = () => {
    if (Platform.OS === 'android') {
      stop();
      return;
    }
    handle.current?.pause();
    setPaused(true);
  };

  const resume = () => {
    handle.current?.resume();
    setPaused(false);
  };

  const stop = () => {
    handle.current?.stop();
    handle.current = null;
    setPlaying(false);
    setPaused(false);
  };

  return (
    <AppScreen>
      <PageHeading title={t('textToSpeech')} subtitle="Native Audio Synthesizer" />
      <InlineNotice tone="info">
        Native speech synthesizer is connected via Expo Speech. Audio plays directly from your device speaker.
      </InlineNotice>
      <Card style={{ gap: 10 }}>
        <AppText weight="semibold">{t('textToSpeech')}</AppText>
        <TextInput
          multiline
          maxLength={600}
          value={text}
          onChangeText={setText}
          placeholder={t('textPlaceholder')}
          placeholderTextColor={palette.muted}
          accessibilityLabel={t('textToSpeech')}
          style={{
            minHeight: 140,
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: 15,
            padding: 14,
            fontSize: 17,
            lineHeight: 25,
            textAlignVertical: 'top',
            color: palette.text,
            backgroundColor: palette.surfaceRaised,
            textAlign: isRTL ? 'right' : 'left',
          }}
        />
        <AppText size={12} color={palette.muted}>
          {text.length}/600
        </AppText>
      </Card>
      <View style={{ gap: 8 }}>
        <AppText weight="semibold">{t('language')}</AppText>
        <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8 }}>
          {langs.map((lang) => (
            <Chip
              key={lang}
              label={lang.toUpperCase()}
              selected={preferences.locale === lang}
              onPress={() => void setPreference('locale', lang)}
            />
          ))}
        </View>
      </View>
      <Card>
        <AppText weight="semibold">Device voice</AppText>
        <AppText size={13} color={palette.muted}>The device selects the voice for the chosen language.</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <AppText weight="semibold">
            {t('speed')}: {speed.toFixed(1)}×
          </AppText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              title="−"
              variant="outline"
              onPress={() => setSpeed((v) => Math.max(0.6, Math.round((v - 0.1) * 10) / 10))}
              style={{ minHeight: 42, minWidth: 48 }}
            />
            <Button
              title="+"
              variant="outline"
              onPress={() => setSpeed((v) => Math.min(1.5, Math.round((v + 0.1) * 10) / 10))}
              style={{ minHeight: 42, minWidth: 48 }}
            />
          </View>
        </View>
      </Card>
      <View style={{ gap: 8 }}>
        <AppText weight="semibold">Example phrases</AppText>
        {samples[preferences.locale].map((sample) => (
          <Pressable
            key={sample}
            accessibilityRole="button"
            onPress={() => setText(sample)}
            style={{ paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: palette.border }}
          >
            <AppText size={14}>{sample}</AppText>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 8 }}>
        <Button
          title={paused ? t('resume') : playing ? (Platform.OS === 'android' ? t('stopDemo') : t('pause')) : t('play')}
          onPress={paused ? resume : playing ? (Platform.OS === 'android' ? stop : pause) : play}
          disabled={!text.trim()}
          icon={
            <MaterialCommunityIcons
              name={paused || !playing ? 'volume-high' : Platform.OS === 'android' ? 'stop' : 'pause'}
              size={18}
              color={palette.primaryText}
            />
          }
          style={{ flex: 1 }}
        />
        <Button title={t('stopDemo')} variant="outline" onPress={stop} disabled={!playing} />
      </View>
      {playing ? (
        <InlineNotice tone="success">{paused ? 'Speech paused.' : 'Playing speech with the device voice.'}</InlineNotice>
      ) : null}
      <Button
        title={t('clear')}
        variant="ghost"
        onPress={() => {
          stop();
          setText('');
        }}
      />
      <Button title={t('close')} variant="ghost" onPress={() => router.back()} />
    </AppScreen>
  );
}
