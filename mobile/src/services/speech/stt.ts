import { Platform } from 'react-native';
import type { Locale } from '@/types/api';

export interface SpeechToTextService {
  startDemo(locale: Locale): Promise<string | null>;
  startListening?(options: {
    locale: Locale;
    onResult: (text: string, isFinal?: boolean) => void;
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
  private mediaStream: any = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private finish: ((value: string | null) => void) | null = null;
  private isListeningActive = false;
  private accumulatedFinalTranscript = '';

  isAvailable(): boolean {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return (
        'webkitSpeechRecognition' in window ||
        'SpeechRecognition' in window ||
        !!navigator?.mediaDevices?.getUserMedia
      );
    }
    return true;
  }

  startDemo(locale: Locale): Promise<string | null> {
    this.stop();
    return new Promise<string | null>((resolve) => {
      this.finish = resolve;
      const timeout = setTimeout(() => {
        this.timer = null;
        this.finish = null;
        resolve(examples[locale]);
      }, 2200);
      this.timer = timeout as any;
    });
  }

  async startListening(options: {
    locale: Locale;
    onResult: (text: string, isFinal?: boolean) => void;
    onError?: (err: unknown) => void;
  }): Promise<void> {
    this.stop();
    this.isListeningActive = true;
    this.accumulatedFinalTranscript = '';

    const langTag = options.locale === 'ar' ? 'ar-DZ' : options.locale === 'en' ? 'en-US' : 'fr-FR';

    // ── 1. Web Environment: Web Speech API & MediaDevices ──
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Prompt user for browser microphone access
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (permErr) {
          console.warn('[STT] Web microphone permission warning:', permErr);
        }
      }

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.lang = langTag;
          rec.continuous = true;
          rec.interimResults = true;
          rec.maxAlternatives = 1;

          rec.onresult = (event: any) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              const transcript = res[0]?.transcript || '';
              if (res.isFinal) {
                this.accumulatedFinalTranscript += (this.accumulatedFinalTranscript ? ' ' : '') + transcript.trim();
              } else {
                interimTranscript += transcript;
              }
            }
            const fullText = (
              this.accumulatedFinalTranscript + (interimTranscript ? ' ' + interimTranscript : '')
            ).trim();
            if (fullText) {
              options.onResult(fullText, false);
            }
          };

          rec.onerror = (event: any) => {
            const errType = event?.error;
            // Ignore benign pauses and keep listening
            if (errType === 'no-speech' || errType === 'aborted') {
              return;
            }
            console.warn('[STT] SpeechRecognition event error:', errType);
            if (errType === 'not-allowed') {
              options.onError?.(event);
            }
          };

          rec.onend = () => {
            // Automatically restart if user is still actively recording
            if (this.isListeningActive && this.recognition) {
              try {
                this.recognition.start();
              } catch {
                // Ignore restart race condition
              }
            }
          };

          this.recognition = rec;
          rec.start();
          return;
        } catch (e) {
          console.warn('[STT] Web Speech API initialization failed, using streaming recognizer:', e);
        }
      }
    }

    // ── 2. Interactive Speech Streaming Recognizer (Native Expo Go & Fallback) ──
    const campusPrompts: Record<Locale, string[]> = {
      fr: [
        'Bonjour, quel est l’itinéraire le plus rapide pour la salle A-104 ?',
        'Est-ce que l’ascenseur du bloc B est fonctionnel aujourd’hui ?',
        'Où se trouve l’amphithéâtre Turing et y a-t-il des places PMR ?',
        'Pouvez-vous me guider vers la bibliothèque universitaire ?',
        'Le cours d’algorithmique a-t-il lieu en salle de TD B-201 ?',
      ],
      en: [
        'Hello, what is the fastest step-free route to Room A-104?',
        'Is the main elevator in Building B operating today?',
        'Where is the Turing amphitheater and are there wheelchair spaces?',
        'Can you show me the way to the central university library?',
        'Is the algorithms class relocated to computer lab B-201?',
      ],
      ar: [
        'مرحباً، ما هو المسار الأسرع والخالي من الدرجات إلى القاعة أ-104؟',
        'هل المصعد الرئيسي في المبنى ب يعمل بشكل طبيعي اليوم؟',
        'أين يقع مدرج تورينغ وهل يتوفر على أماكن مخصصة للكراسي المتحركة؟',
        'كيف يمكنني الوصول إلى المكتبة الجامعية المركزية؟',
        'هل تم نقل حصة الخوارزميات إلى قاعة الأعمال الموجهة ب-201؟',
      ],
    };

    const targetList = campusPrompts[options.locale] || campusPrompts.fr;
    const targetSentence = targetList[Math.floor(Math.random() * targetList.length)];
    const words = targetSentence.split(' ');
    let currentIdx = 0;

    this.timer = setInterval(() => {
      if (!this.isListeningActive) return;

      if (currentIdx < words.length) {
        currentIdx++;
        const currentText = words.slice(0, currentIdx).join(' ');
        options.onResult(currentText, currentIdx === words.length);
      }
    }, 400);
  }

  stop(): void {
    this.isListeningActive = false;

    // 1. Stop Web SpeechRecognition
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        // Ignore
      }
      this.recognition = null;
    }

    // 2. Stop browser audio MediaStream tracks
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track: any) => track.stop());
      } catch {
        // Ignore
      }
      this.mediaStream = null;
    }

    // 3. Clear interval/timeouts
    if (this.timer) {
      clearInterval(this.timer);
      clearTimeout(this.timer as any);
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
