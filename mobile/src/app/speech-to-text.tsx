import React, { useState, useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, InlineNotice, PageHeading } from '@/components/ui';
import { usePreferences } from '@/state/preferences';
import { speechToTextService } from '@/services/speech/stt';
import type { Locale } from '@/types/api';

const localeOptions: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'ar', label: 'العربية' },
];

export default function SpeechToTextScreen() {
  const { t, palette, preferences, setPreference, isRTL } = usePreferences();
  const [locale, setLocale] = useState<Locale>(preferences.locale);
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      speechToTextService.stop();
    };
  }, []);

  const start = () => {
    setState('recording');
    setText('');
    setCopied(false);

    if (speechToTextService.startListening) {
      speechToTextService.startListening({
        locale,
        onResult: (recognized, isFinal) => {
          setText(recognized);
          if (isFinal) {
            setState('done');
          }
        },
        onError: () => {
          setState('idle');
        },
      });
    } else {
      speechToTextService.startDemo(locale).then((result) => {
        if (result) {
          setText(result);
          setState('done');
        } else {
          setState('idle');
        }
      });
    }
  };

  const stop = () => {
    speechToTextService.stop();
    setState(text ? 'done' : 'idle');
  };

  const copy = async () => {
    if (text) {
      await Clipboard.setStringAsync(text);
      setCopied(true);
    }
  };

  return (
    <AppScreen>
      <PageHeading title={t('speechToText')} subtitle={t('prototype')} />
      <InlineNotice tone="info">
        {state === 'recording'
          ? 'Showing a sample transcript. This mobile prototype does not access the microphone.'
          : 'This is a transcript demo. It does not record audio or recognize live speech.'}
      </InlineNotice>
      <Card style={{ alignItems: 'center', paddingVertical: 24, gap: 15 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state === 'recording' ? t('stopDemo') : t('startDemo')}
          accessibilityState={{ busy: state === 'recording' }}
          onPress={state === 'recording' ? stop : start}
          style={({ pressed }) => ({
            width: 94,
            height: 94,
            borderRadius: 47,
            backgroundColor: state === 'recording' ? palette.accent : palette.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.84 : 1,
            elevation: 4,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 8,
          })}
        >
          <MaterialCommunityIcons
            name={state === 'recording' ? 'stop' : 'play'}
            size={38}
            color={palette.primaryText}
          />
        </Pressable>
        <AppText size={18} weight="bold">
          {state === 'recording' ? t('recording') : state === 'done' ? t('speechToText') : t('startDemo')}
        </AppText>
        <AppText size={13} color={palette.muted} style={{ textAlign: 'center', paddingHorizontal: 16 }}>
          {state === 'recording'
            ? 'A sample transcript will appear here.'
            : 'Press start to show a sample transcript.'}
        </AppText>
        <Button
          title={state === 'recording' ? t('stopDemo') : t('startDemo')}
          onPress={state === 'recording' ? stop : start}
          variant={state === 'recording' ? 'danger' : 'primary'}
        />
      </Card>
      <View style={{ gap: 9 }}>
        <AppText weight="semibold">{t('language')}</AppText>
        <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8 }}>
          {localeOptions.map((item) => (
            <Chip
              key={item.id}
              label={item.label}
              selected={locale === item.id}
              onPress={() => {
                setLocale(item.id);
                void setPreference('locale', item.id);
              }}
            />
          ))}
        </View>
      </View>
      <Card style={{ minHeight: 160 }}>
        <AppText size={12} weight="bold" color={palette.primary}>
          {state === 'recording' ? 'SAMPLE TRANSCRIPT' : t('prototype')}
        </AppText>
        <AppText size={16} style={{ marginTop: 8 }}>
          {text || t('transcriptPlaceholder')}
        </AppText>
      </Card>
      <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', gap: 9 }}>
        <Button title={copied ? t('copied') : t('copy')} variant="outline" disabled={!text} onPress={copy} style={{ flex: 1 }} />
        <Button
          title={t('clear')}
          variant="ghost"
          onPress={() => {
            setText('');
            setState('idle');
          }}
          style={{ flex: 1 }}
        />
      </View>
      <Button title={t('close')} variant="ghost" onPress={() => router.back()} />
    </AppScreen>
  );
}
