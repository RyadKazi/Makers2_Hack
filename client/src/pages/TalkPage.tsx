import {
  Copy,
  Ear,
  Languages,
  Mic,
  MicOff,
  Sparkles,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  GraduationCap,
  Accessibility,
  MessageSquare,
  AlertCircle,
  MessagesSquare,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { Page } from '@/components/shell/Page';
import { useSpeechStatus } from '@/features/navigate/useNavigationController';
import { cn } from '@/lib/cn';
import type { Lang } from '@/stores/preferences';

// Web Speech API interface definitions
interface IWindowSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

type SpeechRecognitionConstructor = new () => IWindowSpeechRecognition;

const AAC_PHRASES = [
  {
    category: 'aacCatClass',
    icon: GraduationCap,
    phrases: [
      { fr: 'Bonjour, où se trouve cette salle de cours ?', en: 'Hello, where is this classroom located?', ar: 'مرحباً، أين تقع هذه القاعة الدراسية؟' },
      { fr: 'J’ai un cours prévu dans cette salle aujourd’hui.', en: 'I have a lecture scheduled in this room today.', ar: 'لدي درس مبرمج في هذه القاعة اليوم.' },
      { fr: 'Pouvez-vous répéter ce que vous venez de dire s’il vous plaît ?', en: 'Could you please repeat what you just said?', ar: 'هل يمكنك إعادة ما قلته للتو من فضلك؟' },
      { fr: 'Pouvez-vous écrire au tableau ou sur mon écran ?', en: 'Could you write it on the board or my screen?', ar: 'هل يمكنك الكتابة على السبورة أو شاشتي؟' },
    ],
  },
  {
    category: 'aacCatA11y',
    icon: Accessibility,
    phrases: [
      { fr: 'Pardon, où se situe l’ascenseur PMR le plus proche ?', en: 'Excuse me, where is the nearest accessible elevator?', ar: 'عفواً، أين يقع أقرب مصعد ميسر لذوي الإعاقة؟' },
      { fr: 'Cette entrée dispose-t-elle d’une rampe d’accès ?', en: 'Does this entrance have an access ramp?', ar: 'هل يحتوي هذا المدخل على منحدر وصول؟' },
      { fr: 'Pouvez-vous m’aider à ouvrir la porte s’il vous plaît ?', en: 'Could you please help me open the door?', ar: 'هل يمكنك مساعدتي في فتح الباب من فضلك؟' },
    ],
  },
  {
    category: 'aacCatChat',
    icon: MessageSquare,
    phrases: [
      { fr: 'Bonjour ! Comment allez-vous ?', en: 'Hello! How are you?', ar: 'مرحباً! كيف حالك؟' },
      { fr: 'Merci beaucoup pour votre aide !', en: 'Thank you very much for your help!', ar: 'شكراً جزيلاً لك على مساعدتك!' },
      { fr: 'Je ne peux pas parler, je communique via cette application.', en: 'I cannot speak, I communicate using this application.', ar: 'لا يمكنني التحدث، أنا أتواصل باستخدام هذا التطبيق.' },
      { fr: 'D’accord, c’est très clair, merci.', en: 'All right, that is very clear, thank you.', ar: 'حسناً، هذا واضح جداً، شكراً.' },
    ],
  },
  {
    category: 'aacCatEmergency',
    icon: AlertCircle,
    phrases: [
      { fr: 'J’ai besoin d’une assistance immédiate s’il vous plaît.', en: 'I need immediate assistance, please.', ar: 'أحتاج إلى مساعدة فورية من فضلك.' },
      { fr: 'Je me suis perdu(e) dans ce bâtiment.', en: 'I am lost in this building.', ar: 'لقد ضللت طريقي في هذا المبنى.' },
    ],
  },
];

export function TalkPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const toast = useToast();
  const speechStatus = useSpeechStatus();
  const isCartesiaAvailable = !!speechStatus.data?.tts?.available;

  const [activeTab, setActiveTab] = useState<'sound-to-text' | 'text-to-sound' | 'dialogue'>('sound-to-text');

  // Sound-to-Text State (Speech Recognition)
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [interimText, setInterimText] = useState<string>('');
  const [recLang, setRecLang] = useState<'fr-FR' | 'en-US' | 'ar-DZ'>('fr-FR');
  const [largeFont, setLargeFont] = useState(false);
  const [speechApiSupported, setSpeechApiSupported] = useState(true);
  const recognitionRef = useRef<IWindowSpeechRecognition | null>(null);

  // Text-to-Sound State (Speech Synthesis)
  const [inputText, setInputText] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);

  // Two-way Dialogue State
  const [dialogueHistory, setDialogueHistory] = useState<Array<{ role: 'partner' | 'student'; text: string; time: string }>>([
    {
      role: 'partner',
      text: lang === 'ar' ? 'مرحباً، كيف يمكنني مساعدتك اليوم في قاعة المحاضرات؟' : lang === 'en' ? 'Hello, how can I help you today in the lecture hall?' : 'Bonjour, comment puis-je vous aider aujourd’hui dans la salle de cours ?',
      time: '08:30',
    },
  ]);

  // Configure Web Speech API Recognition
  useEffect(() => {
    const windowObj = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognitionAPI = windowObj.SpeechRecognition || windowObj.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setSpeechApiSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = recLang;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let currentInterim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results.item(i);
          if (item.isFinal) {
            finalChunk += item.item(0).transcript + ' ';
          } else {
            currentInterim += item.item(0).transcript;
          }
        }

        if (finalChunk) {
          setTranscript((prev) => (prev ? prev + ' ' + finalChunk.trim() : finalChunk.trim()));
          if (activeTab === 'dialogue') {
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setDialogueHistory((prev) => [...prev, { role: 'partner', text: finalChunk.trim(), time: now }]);
          }
        }
        setInterimText(currentInterim);
      };

      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        if (e.error === 'not-allowed') {
          toast.show(t('talkPage.micPermissionDenied'), { tone: 'error' });
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText('');
      };

      recognitionRef.current = recognition;
    } catch {
      setSpeechApiSupported(false);
    }

    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, [recLang, activeTab, t, toast]);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.lang = recLang;
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        // restart
        recognitionRef.current.stop();
        setTimeout(() => {
          try {
            recognitionRef.current?.start();
            setIsListening(true);
          } catch {
            // failed
          }
        }, 150);
      }
    }
  }, [isListening, recLang]);

  // Vocalize Text (Text-to-Speech: Cartesia AI if configured, otherwise device voice)
  const speak = useCallback(
    async (textToSpeak: string) => {
      if (!textToSpeak.trim()) return;
      setIsSpeaking(true);

      // 1. Try server Cartesia TTS first if available
      if (isCartesiaAvailable) {
        try {
          const res = await api.post<Blob>(
            '/api/speech/tts',
            { text: textToSpeak.slice(0, 600), lang, speed: speechRate },
            { responseType: 'blob', timeout: 10_000 }
          );
          const url = URL.createObjectURL(res.data);
          const audio = new Audio(url);
          audio.onended = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(url);
          };
          audio.onerror = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(url);
          };
          await audio.play();
          if (activeTab === 'dialogue') {
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setDialogueHistory((prev) => [...prev, { role: 'student', text: textToSpeak, time: now }]);
          }
          return;
        } catch {
          // Fall back to device voice if server TTS fails
        }
      }

      // 2. Device browser voice (speechSynthesis)
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = speechRate;
        utterance.lang = lang === 'ar' ? 'ar-DZ' : lang === 'en' ? 'en-US' : 'fr-FR';

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        window.speechSynthesis.speak(utterance);
      } else {
        setIsSpeaking(false);
        toast.show('Synthèse vocale indisponible sur cet appareil', { tone: 'error' });
      }

      if (activeTab === 'dialogue') {
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setDialogueHistory((prev) => [...prev, { role: 'student', text: textToSpeak, time: now }]);
      }
    },
    [isCartesiaAvailable, lang, speechRate, activeTab, toast]
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.show(t('talkPage.copiedToast'), { tone: 'success' });
  };

  const clearAllTranscript = () => {
    setTranscript('');
    setInterimText('');
  };

  return (
    <Page
      title={t('talkPage.title')}
      description={t('talkPage.subtitle')}
      className="max-w-6xl mx-auto"
    >
      <div className="flex flex-col gap-6">
        {/* Navigation Tabs */}
        <div className="rounded-card border border-line bg-card p-2 shadow-card">
          <Tabs
            idBase="talk-tabs"
            label={t('talkPage.title')}
            value={activeTab}
            onChange={(v) => setActiveTab(v as typeof activeTab)}
            items={[
              {
                value: 'sound-to-text',
                label: t('talkPage.tabSoundToText'),
                icon: Ear,
              },
              {
                value: 'text-to-sound',
                label: t('talkPage.tabTextToSound'),
                icon: Volume2,
              },
              {
                value: 'dialogue',
                label: t('talkPage.tabDialogue'),
                icon: MessagesSquare,
              },
            ]}
          />
        </div>

        {/* ================================================================ */}
        {/* TAB 1: SOUND TO TEXT (Speech-to-Text for Deaf / Hard of Hearing) */}
        {/* ================================================================ */}
        {activeTab === 'sound-to-text' && (
          <div className="flex flex-col gap-5">
            <Card className="flex flex-col gap-4 border-2 border-primary/20">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-control bg-primary-50 text-primary">
                    <Ear className="size-6" />
                  </span>
                  <div>
                    <h2 className="text-h3 text-ink">{t('talkPage.soundToTextTitle')}</h2>
                    <p className="text-sm text-muted">{t('talkPage.soundToTextDesc')}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Language Selector */}
                  <div className="flex min-h-12 items-center gap-1.5 rounded-control border border-line bg-surface-2 px-3 py-1.5 text-sm">
                    <Languages className="size-4 text-primary shrink-0" />
                    <select
                      value={recLang}
                      onChange={(e) => setRecLang(e.target.value as typeof recLang)}
                      className="bg-transparent text-sm font-semibold text-ink outline-none cursor-pointer"
                      aria-label={t('talkPage.langSelect')}
                    >
                      <option value="fr-FR">Français (France / DZ)</option>
                      <option value="en-US">English (US)</option>
                      <option value="ar-DZ">العربية (Algérie)</option>
                    </select>
                  </div>

                  {/* Font size toggle */}
                  <Button
                    variant={largeFont ? 'primary' : 'secondary'}
                    icon={Type}
                    onClick={() => setLargeFont(!largeFont)}
                    aria-pressed={largeFont}
                  >
                    {t('talkPage.largeTextToggle')}
                  </Button>
                </div>
              </div>

              {!speechApiSupported && (
                <div className="flex items-start gap-3 rounded-card border border-warning bg-warning-bg p-4 text-sm text-ink">
                  <AlertCircle className="size-5 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">{t('talkPage.micNotSupported')}</p>
                    <p className="text-muted mt-1">
                      Vous pouvez simuler la transcription en utilisant le mode clavier ci-dessous ou basculer sur l’onglet « Texte vers Voix ».
                    </p>
                  </div>
                </div>
              )}

              {/* Subtitles Screen / Live Transcript Display */}
              <div
                className={cn(
                  'max-h-[460px] min-h-[280px] overflow-y-auto rounded-card border-2 p-6 transition-all',
                  isListening
                    ? 'border-primary bg-primary-50 ring-4 ring-primary/10'
                    : 'border-line bg-surface-2',
                )}
                aria-live="polite"
              >
                {isListening && (
                  <div className="mb-4 flex items-center gap-2 text-primary font-bold text-sm">
                    <span className="relative flex size-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex size-3 rounded-full bg-primary"></span>
                    </span>
                    <span>{t('talkPage.listeningActive')}</span>
                  </div>
                )}

                {transcript || interimText ? (
                  <div className={cn('text-ink font-medium leading-relaxed select-text', largeFont ? 'text-2xl font-bold' : 'text-lg')}>
                    {transcript}
                    {interimText && (
                      <span className="text-primary italic opacity-85"> {interimText}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-muted">
                    <Mic className="size-12 mb-3 text-muted/50" />
                    <p className="text-base font-semibold">{t('talkPage.noSpeechDetected')}</p>
                    <p className="text-sm max-w-md mt-1">
                      Appuyez sur le bouton « Activer le micro » ci-dessous pour retranscrire en direct la voix de votre enseignant ou interlocuteur.
                    </p>
                  </div>
                )}
              </div>

              {/* Microphone and Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <Button
                    size="lg"
                    variant={isListening ? 'danger' : 'primary'}
                    icon={isListening ? MicOff : Mic}
                    onClick={toggleListening}
                    className={cn('font-bold min-w-48 shadow-float', isListening && 'animate-pulse')}
                  >
                    {isListening ? t('talkPage.stopListening') : t('talkPage.startListening')}
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    icon={Copy}
                    disabled={!transcript}
                    onClick={() => copyToClipboard(transcript)}
                  >
                    {t('talkPage.copyTranscript')}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    disabled={!transcript && !interimText}
                    onClick={clearAllTranscript}
                  >
                    {t('talkPage.clearTranscript')}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: TEXT TO SOUND (Text-to-Speech & AAC for Mute/Non-Verbal) */}
        {/* ============================================================== */}
        {activeTab === 'text-to-sound' && (
          <div className="flex flex-col gap-6">
            {/* Free-typing vocalizer */}
            <Card className="flex flex-col gap-4 border-2 border-primary/20">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-control bg-primary-50 text-primary">
                    <Volume2 className="size-6" />
                  </span>
                  <div>
                    <h2 className="text-h3 text-ink">{t('talkPage.textToSoundTitle')}</h2>
                    <p className="text-sm text-muted">{t('talkPage.textToSoundDesc')}</p>
                  </div>
                </div>

                {/* Voice Speed Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-muted">{t('talkPage.speechRate')}:</span>
                  <div className="flex rounded-control border border-line bg-surface-2 p-1 text-sm">
                    {[
                      { rate: 0.8, label: t('talkPage.speedSlow') },
                      { rate: 1.0, label: t('talkPage.speedNormal') },
                      { rate: 1.2, label: t('talkPage.speedFast') },
                    ].map((s) => (
                      <button
                        key={s.rate}
                        type="button"
                        onClick={() => setSpeechRate(s.rate)}
                        className={cn(
                          'min-h-12 rounded-control px-3 py-1 font-bold transition-colors',
                          speechRate === s.rate ? 'bg-primary text-on-primary' : 'text-ink',
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Text Area */}
              <div className="relative">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      speak(inputText);
                    }
                  }}
                  rows={4}
                  placeholder={t('talkPage.typeToSpeakPlaceholder')}
                  className="w-full resize-y rounded-card border-2 border-line bg-surface-2 p-4 text-lg text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    size="lg"
                    variant="primary"
                    icon={isSpeaking ? Volume2 : Sparkles}
                    loading={isSpeaking}
                    disabled={!inputText.trim()}
                    onClick={() => speak(inputText)}
                    className="font-bold min-w-44 shadow-float bg-primary hover:bg-primary-800 text-on-primary"
                  >
                    {isSpeaking ? t('talkPage.speakingNow') : t('talkPage.speakText')}
                  </Button>
                  {isSpeaking && (
                    <Button
                      variant="secondary"
                      icon={VolumeX}
                      onClick={() => {
                        window.speechSynthesis?.cancel();
                        setIsSpeaking(false);
                      }}
                    >
                      Arrêter
                    </Button>
                  )}
                </div>

                {inputText && (
                  <Button variant="ghost" icon={Trash2} onClick={() => setInputText('')}>
                    {t('talkPage.clearTranscript')}
                  </Button>
                )}
              </div>
            </Card>

            {/* Instant AAC Communication Board */}
            <Card className="flex flex-col gap-4">
              <div className="border-b border-line pb-3">
                <h3 className="text-h3 text-ink flex items-center gap-2">
                  <Sparkles className="size-5 text-available shrink-0" />
                  {t('talkPage.aacBoardTitle')}
                </h3>
                <p className="text-sm text-muted">{t('talkPage.aacBoardDesc')}</p>
              </div>

              <div className="grid gap-6 tablet:grid-cols-2">
                {AAC_PHRASES.map((group) => {
                  const Icon = group.icon;
                  return (
                    <div key={group.category} className="flex flex-col gap-2.5 rounded-card border border-line bg-surface-2 p-4">
                      <div className="flex items-center gap-2 font-bold text-base text-primary">
                        <Icon className="size-5 shrink-0" />
                        <span>{t(`talkPage.${group.category}`)}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.phrases.map((phrase, idx) => {
                          const localizedPhrase = lang === 'ar' ? phrase.ar : lang === 'en' ? phrase.en : phrase.fr;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setInputText(localizedPhrase);
                                speak(localizedPhrase);
                              }}
                              className="group flex min-h-12 items-center justify-between gap-3 rounded-card border border-line bg-card p-3 text-start transition-all hover:border-primary hover:bg-cream"
                            >
                              <span className="text-sm font-medium text-ink group-hover:text-primary">
                                {localizedPhrase}
                              </span>
                              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-2 text-muted group-hover:bg-primary group-hover:text-on-primary">
                                <Volume2 className="size-4" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: TWO-WAY DIALOGUE (Face-to-Face Dual Conversation)        */}
        {/* ============================================================== */}
        {activeTab === 'dialogue' && (
          <Card className="flex flex-col gap-5 border-2 border-primary/20">
            <div className="border-b border-line pb-3">
              <h2 className="text-h3 text-ink flex items-center gap-2">
                <MessagesSquare className="size-6 text-primary" />
                {t('talkPage.tabDialogue')}
              </h2>
              <p className="text-sm text-muted">
                Échangez facilement en face-à-face : l’interlocuteur parle dans le micro (transcrit en texte pour vous), et vous écrivez votre réponse pour qu’elle soit vocaliste à haute voix.
              </p>
            </div>

            {/* Conversation Flow */}
            <div className="flex max-h-[460px] min-h-[300px] flex-col gap-3 overflow-y-auto rounded-card border border-line bg-surface-2 p-4">
              {dialogueHistory.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex max-w-[85%] flex-col rounded-card p-4 shadow-card',
                    msg.role === 'partner'
                      ? 'self-start border border-line bg-card text-ink'
                      : 'self-end bg-primary text-on-primary border-transparent'
                  )}
                >
                  <div className="flex items-center justify-between gap-3 text-sm mb-1 opacity-80">
                    <span className="font-bold flex items-center gap-1">
                      {msg.role === 'partner' ? (
                        <>
                          <Ear className="size-3.5" />
                          {t('talkPage.dialoguePartner')}
                        </>
                      ) : (
                        <>
                          <Volume2 className="size-3.5" />
                          {t('talkPage.dialogueStudent')}
                        </>
                      )}
                    </span>
                    <span>{msg.time}</span>
                  </div>
                  <p className="text-base font-semibold leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>

            {/* Split Input Controls */}
            <div className="grid gap-4 tablet:grid-cols-2 pt-2 border-t border-line">
              {/* Partner Listen Control */}
              <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-ink flex items-center gap-1.5">
                    <Mic className="size-4 text-primary" />
                    Parole de l’interlocuteur
                  </span>
                  {isListening && (
                    <span className="flex items-center gap-1 text-sm text-primary font-bold animate-pulse">
                      <span className="size-2 rounded-full bg-primary" />
                      Écoute active
                    </span>
                  )}
                </div>
                <Button
                  variant={isListening ? 'danger' : 'secondary'}
                  icon={isListening ? MicOff : Mic}
                  onClick={toggleListening}
                  className="w-full font-bold"
                >
                  {isListening ? 'Couper le micro' : 'Écouter l’interlocuteur'}
                </Button>
              </div>

              {/* Student Speak Control */}
              <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-3.5">
                <span className="text-sm font-bold text-ink flex items-center gap-1.5">
                  <Type className="size-4 text-primary" />
                  Votre réponse écrite
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        speak(inputText);
                        setInputText('');
                      }
                    }}
                    placeholder="Écrivez votre réponse..."
                    className="min-h-12 flex-1 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none"
                  />
                  <Button
                    variant="primary"
                    icon={Volume2}
                    disabled={!inputText.trim()}
                    onClick={() => {
                      speak(inputText);
                      setInputText('');
                    }}
                    className="shrink-0 font-bold bg-primary text-on-primary"
                  >
                    Envoyer & Dire
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}
