import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { Locale } from '@/types/api';

export type TtsPreviewOptions = { locale: Locale; speed: number; voice?: string };
export interface PreviewHandle { pause(): void; resume(): void; stop(): void; }

export interface TextToSpeechService {
  createPreview(text: string, options: TtsPreviewOptions, onEnded: () => void): PreviewHandle;
  speak(text: string, options?: { locale?: Locale; speed?: number; onDone?: () => void; onError?: () => void }): Promise<void>;
  stop(): Promise<void>;
  isSpeakingAsync(): Promise<boolean>;
}

export function localeToLanguageTag(locale: Locale): string {
  switch (locale) {
    case 'ar':
      return 'ar-SA';
    case 'en':
      return 'en-US';
    case 'fr':
    default:
      return 'fr-FR';
  }
}

export class NativeTextToSpeech implements TextToSpeechService {
  async speak(text: string, options?: { locale?: Locale; speed?: number; onDone?: () => void; onError?: () => void }) {
    if (!text.trim()) return;
    const language = localeToLanguageTag(options?.locale ?? 'fr');
    Speech.stop();
    Speech.speak(text, {
      language,
      rate: options?.speed ?? 1.0,
      pitch: 1.0,
      onDone: options?.onDone,
      onStopped: options?.onDone,
      onError: options?.onError,
    });
  }

  async stop() {
    Speech.stop();
  }

  async isSpeakingAsync() {
    return Speech.isSpeakingAsync();
  }

  createPreview(text: string, options: TtsPreviewOptions, onEnded: () => void): PreviewHandle {
    const language = localeToLanguageTag(options.locale);
    let ended = false;
    let paused = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      onEnded();
    };
    Speech.stop();
    Speech.speak(text, {
      language,
      rate: options.speed,
      pitch: 1.0,
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });

    return {
      pause() {
        if (ended) return;
        if (Platform.OS === 'android') {
          // Expo Speech cannot pause on Android; stop cleanly instead of
          // pretending the utterance can resume from its previous position.
          Speech.stop();
          finish();
          return;
        }
        paused = true;
        void Speech.pause();
      },
      resume() {
        if (ended || !paused) return;
        paused = false;
        void Speech.resume();
      },
      stop() {
        Speech.stop();
        finish();
      },
    };
  }
}

/**
 * Static mock fallback kept for Jest unit testing
 */
export class StaticTextToSpeech implements TextToSpeechService {
  async speak(_text: string) {}
  async stop() {}
  async isSpeakingAsync() { return false; }

  createPreview(text: string, options: TtsPreviewOptions, onEnded: () => void): PreviewHandle {
    const total = Math.max(1200, Math.min(12000, (text.length * 45) / options.speed));
    let remaining = total;
    let started = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const finish = () => {
      timer = null;
      if (!stopped) onEnded();
    };
    const resume = () => {
      if (stopped || timer) return;
      started = Date.now();
      timer = setTimeout(finish, remaining);
    };
    resume();
    return {
      pause() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
          remaining = Math.max(0, remaining - (Date.now() - started));
        }
      },
      resume,
      stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
      },
    };
  }
}

export const textToSpeechService: TextToSpeechService = new NativeTextToSpeech();
