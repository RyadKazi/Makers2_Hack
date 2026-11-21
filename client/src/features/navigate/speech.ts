/**
 * Spoken guidance. Server voice (Cartesia, through /api/speech/tts) when it is
 * available for the language and the user is signed in; otherwise the device voice
 * (speechSynthesis). Any server failure falls back for that sentence, and a 503
 * (no voice configured) switches to the device voice for the rest of the session.
 */
import { api } from '@/api/client';
import type { Lang } from '@/stores/preferences';

const VOICE_LANG: Record<Lang, string> = { ar: 'ar-DZ', fr: 'fr-FR', en: 'en-GB' };

type Utterance = { text: string; lang: Lang };

export type SpeakerOptions = {
  /** Server TTS allowed now (status says available for this language, user signed in). */
  serverVoice: (lang: Lang) => boolean;
  rate?: number;
};

export class Speaker {
  private queue: Utterance[] = [];
  private speaking = false;
  private audio: HTMLAudioElement | null = null;
  private serverDisabled = false;
  private cache = new Map<string, string>();
  private generation = 0;
  muted = false;

  constructor(private readonly options: SpeakerOptions) {}

  /** interrupt: stop what is being said and drop the queue (alerts, "repeat", "where am I"). */
  speak(text: string, lang: Lang, { interrupt = false }: { interrupt?: boolean } = {}): void {
    if (this.muted || !text.trim()) return;
    if (interrupt) this.stop();
    this.queue.push({ text, lang });
    if (!this.speaking) void this.next();
  }

  stop(): void {
    this.generation += 1;
    this.queue = [];
    this.speaking = false;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
  }

  dispose(): void {
    this.stop();
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
  }

  private async next(): Promise<void> {
    const item = this.queue.shift();
    if (!item) {
      this.speaking = false;
      return;
    }
    this.speaking = true;
    const gen = this.generation;
    try {
      if (!this.serverDisabled && this.options.serverVoice(item.lang)) await this.playServer(item, gen);
      else await this.playDevice(item, gen);
    } catch {
      if (gen === this.generation) await this.playDevice(item, gen).catch(() => undefined);
    }
    if (gen === this.generation) void this.next();
  }

  private async playServer(item: Utterance, gen: number): Promise<void> {
    const key = `${item.lang}|${item.text}`;
    let url = this.cache.get(key);
    if (!url) {
      try {
        const res = await api.post<Blob>('/api/speech/tts', { text: item.text.slice(0, 600), lang: item.lang, speed: this.options.rate ?? 1 }, { responseType: 'blob', timeout: 12_000 });
        url = URL.createObjectURL(res.data);
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 503 || status === 401) this.serverDisabled = true;
        throw err;
      }
      this.cache.set(key, url);
      if (this.cache.size > 60) {
        const [oldKey, oldUrl] = this.cache.entries().next().value as [string, string];
        URL.revokeObjectURL(oldUrl);
        this.cache.delete(oldKey);
      }
    }
    if (gen !== this.generation) return;
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      this.audio = audio;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('audio'));
      audio.play().catch(reject);
    });
  }

  private playDevice(item: Utterance, gen: number): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || gen !== this.generation) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = VOICE_LANG[item.lang];
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(item.lang));
      if (voice) u.voice = voice;
      u.rate = this.options.rate ?? 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
}

/** Short vibration patterns (ignored where unsupported or disabled). */
export function vibrate(pattern: number[] | null): void {
  if (!pattern || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* not allowed (no user gesture yet) */
  }
}
