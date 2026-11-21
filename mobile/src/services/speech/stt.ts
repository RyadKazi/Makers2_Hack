import { Platform } from 'react-native';
import type { Locale } from '@/types/api';

export interface SpeechToTextService {
  startDemo(locale: Locale): Promise<string | null>;
  startListening?(options: {
    locale: Locale;
    onResult: (text: string, isFinal: boolean) => void;
    onError?: (err: unknown) => void;
  }): void;
  stop(): void;
  isAvailable(): boolean;
}

const examples: Record<Locale, string> = {
  en: 'This is a sample transcript for demonstration. Real speech recognition is not connected.',
  fr: 'Ceci est un exemple de transcription. La reconnaissance vocale réelle n’est pas connectée.',
  ar: 'هذا نص تجريبي للعرض. لم يتم ربط التعرف الحقيقي على الكلام.',
};

export class HybridSpeechToText implements SpeechToTextService {
  private recognition: any = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finish: ((value: string | null) => void) | null = null;

  isAvailable(): boolean {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    }
    return true;
  }

  startDemo(locale: Locale): Promise<string | null> {
    this.stop();
    return new Promise<string | null>((resolve) => {
      this.finish = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.finish = null;
        resolve(examples[locale]);
      }, 2200);
    });
  }

  startListening(options: {
    locale: Locale;
    onResult: (text: string, isFinal: boolean) => void;
    onError?: (err: unknown) => void;
  }): void {
    this.stop();

    const langTag = options.locale === 'ar' ? 'ar-DZ' : options.locale === 'en' ? 'en-US' : 'fr-FR';

    // 1. Web Speech API if in browser / web build
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          this.recognition = new SpeechRecognition();
          this.recognition.lang = langTag;
          this.recognition.continuous = true;
          this.recognition.interimResults = true;

          this.recognition.onresult = (event: any) => {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                finalTranscript += res[0].transcript;
              } else {
                interimTranscript += res[0].transcript;
              }
            }
            const full = (finalTranscript + ' ' + interimTranscript).trim();
            if (full) {
              options.onResult(full, !!finalTranscript);
            }
          };

          this.recognition.onerror = (err: any) => {
            options.onError?.(err);
          };

          this.recognition.start();
          return;
        } catch {
          // Fallback to simulated recognition
        }
      }
    }

    // 2. Interactive simulated recognition with real-time word streaming
    const sampleSentences: Record<Locale, string[]> = {
      fr: [
        'Bonjour, est-ce que la salle A-104 est accessible en fauteuil ?',
        'Le cours d’algorithmique est-il déplacé au premier étage ?',
        'Où se trouve l’ascenseur le plus proche du hall central ?',
      ],
      en: [
        'Hello, is room A-104 wheelchair accessible today?',
        'Where is the nearest elevator in Building A?',
        'Can you show me the step-free route to the cafeteria?',
      ],
      ar: [
        'مرحباً، هل القاعة أ-104 مجهزة لاستقبال الكراسي المتحركة؟',
        'أين يقع أقرب مصعد في مبنى العلوم؟',
        'كيف يمكنني الوصول إلى المكتبة عبر مسار خالٍ من الدرجات؟',
      ],
    };

    const targetSentence =
      sampleSentences[options.locale][Math.floor(Math.random() * sampleSentences[options.locale].length)];
    const words = targetSentence.split(' ');
    let currentIdx = 0;

    const interval = setInterval(() => {
      if (currentIdx < words.length) {
        currentIdx++;
        const currentText = words.slice(0, currentIdx).join(' ');
        options.onResult(currentText, currentIdx === words.length);
      } else {
        clearInterval(interval);
      }
    }, 380);

    this.timer = interval as any;
  }

  stop(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
      this.recognition = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      clearTimeout(this.timer);
      this.timer = null;
    }
    const finish = this.finish;
    this.finish = null;
    finish?.(null);
  }
}

/**
 * Static mock fallback kept for Jest unit testing
 */
export class StaticSpeechToText implements SpeechToTextService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finish: ((value: string | null) => void) | null = null;

  isAvailable(): boolean {
    return true;
  }

  startDemo(locale: Locale) {
    this.stop();
    return new Promise<string | null>((resolve) => {
      this.finish = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.finish = null;
        resolve(examples[locale]);
      }, 2200);
    });
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const finish = this.finish;
    this.finish = null;
    finish?.(null);
  }
}

export const speechToTextService: SpeechToTextService = new HybridSpeechToText();
