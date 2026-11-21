import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { AppScreen, AppText, Button, Card, Chip, InlineNotice, PageHeading, SectionTitle } from '@/components/ui';
import { speechToTextService } from '@/services/speech/stt';
import { textToSpeechService } from '@/services/speech/tts';
import { usePreferences } from '@/state/preferences';

type AacCategory = 'essentials' | 'classroom' | 'campus' | 'help';

interface AacPhrase {
  id: string;
  category: AacCategory;
  en: string;
  fr: string;
  ar: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

const AAC_PHRASES: AacPhrase[] = [
  { id: 'p1', category: 'essentials', en: 'Yes, absolutely', fr: 'Oui, tout à fait', ar: 'نعم، بكل تأكيد', icon: 'check-circle' },
  { id: 'p2', category: 'essentials', en: 'No, thank you', fr: 'Non, merci', ar: 'لا، شكراً', icon: 'close-circle' },
  { id: 'p3', category: 'essentials', en: 'Please wait a moment', fr: 'Un instant s’il vous plaît', ar: 'لحظة من فضلك', icon: 'clock-outline' },
  { id: 'p4', category: 'essentials', en: 'Thank you very much', fr: 'Merci beaucoup pour votre aide', ar: 'شكراً جزيلاً لك', icon: 'hand-heart' },

  { id: 'p5', category: 'classroom', en: 'Could you please repeat that?', fr: 'Pourriez-vous répéter la dernière phrase ?', ar: 'هل يمكنك إعادة الجملة الأخيرة؟', icon: 'replay' },
  { id: 'p6', category: 'classroom', en: 'I have a question about this slide', fr: 'J’ai une question concernant cette diapositive', ar: 'لدي سؤال بخصوص هذه الشريحة', icon: 'help-circle-outline' },
  { id: 'p7', category: 'classroom', en: 'I need extra time to take notes', fr: 'J’ai besoin d’un peu plus de temps pour noter', ar: 'أحتاج وقتاً إضافياً لتدوين الملاحظات', icon: 'pencil-outline' },
  { id: 'p8', category: 'classroom', en: 'Can you turn on captions / mic?', fr: 'Pouvez-vous activer le micro ou les sous-titres ?', ar: 'هل يمكنك تفعيل الميكروفون أو التسميات؟', icon: 'closed-caption' },

  { id: 'p9', category: 'campus', en: 'Where is the nearest elevator?', fr: 'Où se trouve l’ascenseur le plus proche ?', ar: 'أين هو أقرب مصعد؟', icon: 'elevator-passenger' },
  { id: 'p10', category: 'campus', en: 'Is this room free right now?', fr: 'Est-ce que cette salle est libre actuellement ?', ar: 'هل هذه القاعة فارغة حالياً؟', icon: 'door-open' },
  { id: 'p11', category: 'campus', en: 'How do I get to the cafeteria?', fr: 'Quel est le chemin pour aller à la cafétéria ?', ar: 'ما هو المسار إلى الكافيتريا؟', icon: 'silverware-fork-knife' },
  { id: 'p12', category: 'campus', en: 'Where is the student disability office?', fr: 'Où est le bureau d’accompagnement étudiant ?', ar: 'أين هو مكتب مرافقة الطلاب ذوي الإعاقة؟', icon: 'domain' },

  { id: 'p13', category: 'help', en: 'I need physical assistance', fr: 'J’ai besoin d’aide pour ouvrir cette porte', ar: 'أحتاج مساعدة لفتح هذا الباب', icon: 'hand-back-right' },
  { id: 'p14', category: 'help', en: 'Please speak a bit slower', fr: 'Merci de parler un peu plus lentement', ar: 'يرجى التحدث ببطء أكثر', icon: 'speedometer-slow' },
  { id: 'p15', category: 'help', en: 'I am lost, can you guide me?', fr: 'Je suis un peu perdu, pouvez-vous m’orienter ?', ar: 'أنا تائه، هل يمكنك توجيهي؟', icon: 'map-marker-question' },
];

interface ChatMessage {
  id: string;
  sender: 'me' | 'other';
  text: string;
  time: string;
}

export default function TalkScreen() {
  const { t, palette, preferences, isRTL } = usePreferences();
  const [activeTab, setActiveTab] = useState<'tts' | 'stt' | 'dialogue'>('tts');

  // Text-To-Speech (AAC) State
  const [inputText, setInputText] = useState('Bonjour, pouvez-vous m’orienter vers la salle A-104 ?');
  const [selectedCategory, setSelectedCategory] = useState<AacCategory>('essentials');
  const [speakingState, setSpeakingState] = useState<'idle' | 'speaking'>('idle');
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0);

  // Sound-To-Text (STT) State
  const [isRecording, setIsRecording] = useState(false);
  const [sttTranscript, setSttTranscript] = useState(
    'Bonjour, le cours de structures de données aura lieu en salle A-104 au rez-de-chaussée.'
  );
  const [copiedNotice, setCopiedNotice] = useState(false);

  // Dialogue State
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'm1', sender: 'other', text: 'Bonjour ! Comment puis-je vous aider aujourd’hui ?', time: '10:14' },
    { id: 'm2', sender: 'me', text: 'Bonjour, je cherche l’amphithéâtre Turing avec accès PMR.', time: '10:15' },
    { id: 'm3', sender: 'other', text: 'C’est au rez-de-chaussée du bâtiment A, juste après la rampe.', time: '10:16' },
  ]);
  const [dialogueInput, setDialogueInput] = useState('');

  useEffect(() => {
    return () => {
      speechToTextService.stop();
      void textToSpeechService.stop();
    };
  }, []);

  const handleSpeak = async (textToSpeak: string) => {
    if (!textToSpeak.trim()) return;
    setSpeakingState('speaking');
    try {
      await textToSpeechService.speak(textToSpeak, {
        locale: preferences.locale,
        speed: speechSpeed,
        onDone: () => setSpeakingState('idle'),
        onError: () => setSpeakingState('idle'),
      });
    } catch {
      setSpeakingState('idle');
    }
  };

  const handleStopSpeaking = async () => {
    await textToSpeechService.stop();
    setSpeakingState('idle');
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      speechToTextService.stop();
      setIsRecording(false);
    } else {
      setIsRecording(true);
      setSttTranscript('');
      if (Platform.OS === 'web' && speechToTextService.startListening) {
        speechToTextService.startListening({
          locale: preferences.locale,
          onResult: text => setSttTranscript(text),
          onError: error => {
            console.warn('[Talk] Speech recognition error:', error);
            setIsRecording(false);
          },
        });
      } else {
        setSttTranscript('Loading sample transcript...');
        void speechToTextService.startDemo(preferences.locale).then(sample => {
          if (sample) setSttTranscript(sample);
          setIsRecording(false);
        });
      }
    }
  };

  const handleCopyTranscript = async () => {
    if (!sttTranscript) return;
    await Clipboard.setStringAsync(sttTranscript);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  const handleSendDialogue = () => {
    if (!dialogueInput.trim()) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'me',
      text: dialogueInput.trim(),
      time: timeStr,
    };
    setMessages(prev => [...prev, newMsg]);
    setDialogueInput('');

    // Optional: speak user message
    void handleSpeak(newMsg.text);

    // Companion simulated response
    setTimeout(() => {
      const respText = 'Bien reçu ! Si vous avez besoin d’autre chose, faites-moi signe.';
      const respMsg: ChatMessage = {
        id: `msg-resp-${Date.now()}`,
        sender: 'other',
        text: respText,
        time: timeStr,
      };
      setMessages(prev => [...prev, respMsg]);
    }, 1500);
  };

  const currentLang = preferences.locale;
  const filteredPhrases = AAC_PHRASES.filter(p => p.category === selectedCategory);
  const isRTLRow = isRTL ? 'row-reverse' : 'row';

  return (
    <AppScreen>
      <PageHeading
        eyebrow="ACCESSIBILITY SUITE"
        title={t('talk')}
        subtitle={t('prototype')}
      />

      {/* Mode Switcher Tabs */}
      <View style={[styles.tabBar, { backgroundColor: palette.surface2, borderColor: palette.line }]}>
        <Pressable
          accessibilityRole="tab"
          onPress={() => {
            void handleStopSpeaking();
            setActiveTab('tts');
          }}
          style={[styles.tabButton, activeTab === 'tts' && { backgroundColor: palette.primary }]}>
          <MaterialCommunityIcons name="account-voice" size={18} color={activeTab === 'tts' ? palette.onPrimary : palette.text} />
          <AppText size={13} weight="bold" color={activeTab === 'tts' ? palette.onPrimary : palette.text}>
            {t('textToSound')}
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          onPress={() => {
            void handleStopSpeaking();
            setActiveTab('stt');
          }}
          style={[styles.tabButton, activeTab === 'stt' && { backgroundColor: palette.primary }]}>
          <MaterialCommunityIcons name="microphone" size={18} color={activeTab === 'stt' ? palette.onPrimary : palette.text} />
          <AppText size={13} weight="bold" color={activeTab === 'stt' ? palette.onPrimary : palette.text}>
            {t('soundToText')}
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          onPress={() => {
            void handleStopSpeaking();
            setActiveTab('dialogue');
          }}
          style={[styles.tabButton, activeTab === 'dialogue' && { backgroundColor: palette.primary }]}>
          <MaterialCommunityIcons name="forum-outline" size={18} color={activeTab === 'dialogue' ? palette.onPrimary : palette.text} />
          <AppText size={13} weight="bold" color={activeTab === 'dialogue' ? palette.onPrimary : palette.text}>
            {t('dialogue')}
          </AppText>
        </Pressable>
      </View>

      {/* TAB 1: TEXT-TO-SOUND (TTS / AAC) */}
      {activeTab === 'tts' ? (
        <View style={{ gap: 14 }}>
          {/* Custom Message Card */}
          <Card style={{ gap: 12 }}>
            <SectionTitle title="Vocalisation de texte en direct" />
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              multiline
              numberOfLines={3}
              placeholder="Tapez le texte à faire prononcer par les haut-parleurs..."
              placeholderTextColor={palette.muted}
              style={[
                styles.ttsInput,
                {
                  borderColor: palette.line,
                  backgroundColor: palette.surface2,
                  color: palette.ink,
                  textAlign: isRTL ? 'right' : 'left',
                },
              ]}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AppText size={13} color={palette.muted}>Vitesse :</AppText>
                {[0.8, 1.0, 1.2].map(spd => (
                  <Chip
                    key={spd}
                    label={`${spd}×`}
                    selected={speechSpeed === spd}
                    onPress={() => setSpeechSpeed(spd)}
                  />
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                {speakingState === 'speaking' ? (
                  <Button
                    title="Arrêter"
                    variant="danger"
                    icon={<MaterialCommunityIcons name="stop" size={20} color="#FFFFFF" />}
                    onPress={handleStopSpeaking}
                  />
                ) : (
                  <Button
                    title="Parler à voix haute"
                    disabled={!inputText.trim()}
                    icon={<MaterialCommunityIcons name="volume-high" size={20} color={palette.onPrimary} />}
                    onPress={() => handleSpeak(inputText)}
                  />
                )}
              </View>
            </View>

            {speakingState === 'speaking' ? (
              <InlineNotice tone="success">
                Lecture vocale en cours sur votre appareil ({preferences.locale.toUpperCase()})...
              </InlineNotice>
            ) : null}
          </Card>

          {/* AAC Quick Phrases */}
          <Card style={{ gap: 12 }}>
            <SectionTitle title={t('quickPhrases')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(['essentials', 'classroom', 'campus', 'help'] as AacCategory[]).map(cat => (
                <Chip
                  key={cat}
                  label={cat === 'essentials' ? 'Essentiels' : cat === 'classroom' ? 'En cours' : cat === 'campus' ? 'Campus' : 'Assistance'}
                  selected={selectedCategory === cat}
                  onPress={() => setSelectedCategory(cat)}
                />
              ))}
            </ScrollView>

            {/* Quick Phrase Grid */}
            <View style={styles.phraseGrid}>
              {filteredPhrases.map(item => {
                const phraseText = currentLang === 'ar' ? item.ar : currentLang === 'en' ? item.en : item.fr;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      setInputText(phraseText);
                      void handleSpeak(phraseText);
                    }}
                    style={[styles.phraseCard, { borderColor: palette.line, backgroundColor: palette.surface2 }]}>
                    <MaterialCommunityIcons name={item.icon} size={24} color={palette.primary} />
                    <AppText size={14} weight="semibold" style={{ flex: 1 }}>{phraseText}</AppText>
                    <View style={[styles.speakIconBadge, { backgroundColor: palette.primary }]}>
                      <MaterialCommunityIcons name="volume-high" size={16} color={palette.onPrimary} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </View>
      ) : null}

      {/* TAB 2: SOUND-TO-TEXT (STT / RECOGNITION) */}
      {activeTab === 'stt' ? (
        <View style={{ gap: 14 }}>
          <Card style={{ gap: 14, alignItems: 'center', paddingVertical: 24 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isRecording ? 'Stop transcript' : Platform.OS === 'web' ? 'Start microphone transcription' : 'Show sample transcript'}
              onPress={handleToggleRecord}
              style={[
                styles.micButton,
                {
                  backgroundColor: isRecording ? palette.danger : palette.primary,
                  borderColor: isRecording ? '#FFA5A5' : palette.primary50,
                },
              ]}>
              <MaterialCommunityIcons name={isRecording ? 'stop' : 'play'} size={42} color={palette.onPrimary} />
            </Pressable>

            <AppText size={17} weight="bold">
              {isRecording ? (Platform.OS === 'web' ? 'Listening...' : 'Showing sample transcript...') : (Platform.OS === 'web' ? 'Start microphone transcription' : 'Show sample transcript')}
            </AppText>

            {isRecording ? (
              <View style={styles.soundWaveRow}>
                <View style={[styles.soundBar, { height: 18, backgroundColor: palette.danger }]} />
                <View style={[styles.soundBar, { height: 28, backgroundColor: palette.danger }]} />
                <View style={[styles.soundBar, { height: 14, backgroundColor: palette.danger }]} />
                <View style={[styles.soundBar, { height: 32, backgroundColor: palette.danger }]} />
                <View style={[styles.soundBar, { height: 20, backgroundColor: palette.danger }]} />
              </View>
            ) : (
              <View style={{ alignItems: 'center', gap: 8 }}>
                <AppText size={13} color={palette.muted} style={{ textAlign: 'center' }}>
                  {Platform.OS === 'web' ? 'Browser speech recognition is available when supported.' : 'Mobile uses a sample transcript and does not access the microphone.'}
                </AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {[
                    'Où est la salle A-104 ?',
                    'Ascenseur du bloc B fonctionnel ?',
                    'Places PMR à l’amphi Turing ?',
                    'Itinéraire vers la bibliothèque',
                  ].map(sample => (
                    <Chip
                      key={sample}
                      label={sample}
                      selected={false}
                      onPress={() => setSttTranscript(sample)}
                    />
                  ))}
                </View>
              </View>
            )}
          </Card>

          {/* Transcript Output Box */}
          <Card style={{ gap: 12 }}>
            <View style={[styles.transcriptHeader, { flexDirection: isRTLRow }]}>
              <SectionTitle title="Transcription du discours" />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={handleCopyTranscript} hitSlop={8}>
                  <MaterialCommunityIcons name="content-copy" size={20} color={palette.primary} />
                </Pressable>
                <Pressable onPress={() => setSttTranscript('')} hitSlop={8}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={palette.muted} />
                </Pressable>
              </View>
            </View>

            <TextInput
              value={sttTranscript}
              onChangeText={setSttTranscript}
              multiline
              style={[
                styles.transcriptBox,
                {
                  borderColor: palette.line,
                  backgroundColor: palette.surface2,
                  color: palette.ink,
                  textAlign: isRTL ? 'right' : 'left',
                },
              ]}
            />

            {copiedNotice ? <InlineNotice tone="success">Texte copié dans le presse-papier !</InlineNotice> : null}

            {sttTranscript ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  title="Lire la transcription à voix haute"
                  icon={<MaterialCommunityIcons name="volume-high" size={18} color={palette.onPrimary} />}
                  onPress={() => handleSpeak(sttTranscript)}
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}

      {/* TAB 3: DIALOGUE */}
      {activeTab === 'dialogue' ? (
        <View style={{ gap: 14 }}>
          <Card style={{ gap: 12, paddingBottom: 16 }}>
            <SectionTitle title="Dialogue interactif étudiant & personnel" />

            <View style={{ gap: 10, minHeight: 240 }}>
              {messages.map(m => {
                const isMe = m.sender === 'me';
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.chatBubbleWrapper,
                      isMe ? { alignSelf: 'flex-end', alignItems: 'flex-end' } : { alignSelf: 'flex-start', alignItems: 'flex-start' },
                    ]}>
                    <View
                      style={[
                        styles.chatBubble,
                        isMe
                          ? { backgroundColor: palette.primary, borderBottomRightRadius: 2 }
                          : { backgroundColor: palette.surface2, borderBottomLeftRadius: 2 },
                      ]}>
                      <AppText size={14} color={isMe ? palette.onPrimary : palette.ink}>
                        {m.text}
                      </AppText>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <AppText size={11} color={palette.muted}>{m.time}</AppText>
                      <Pressable onPress={() => handleSpeak(m.text)} hitSlop={6}>
                        <MaterialCommunityIcons name="volume-medium" size={15} color={palette.primary} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Input Row */}
            <View style={[styles.chatInputRow, { borderColor: palette.line, backgroundColor: palette.surface2 }]}>
              <TextInput
                value={dialogueInput}
                onChangeText={setDialogueInput}
                placeholder="Écrire votre message..."
                placeholderTextColor={palette.muted}
                style={[styles.chatInput, { color: palette.ink }]}
              />
              <Pressable
                accessibilityRole="button"
                onPress={handleSendDialogue}
                disabled={!dialogueInput.trim()}
                style={[styles.sendButton, { backgroundColor: palette.primary, opacity: dialogueInput.trim() ? 1 : 0.5 }]}>
                <MaterialCommunityIcons name="send" size={18} color={palette.onPrimary} />
              </Pressable>
            </View>
          </Card>
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  ttsInput: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    fontSize: 15,
  },
  phraseGrid: {
    gap: 8,
  },
  phraseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  speakIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  soundWaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
  },
  soundBar: {
    width: 5,
    borderRadius: 3,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transcriptBox: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    lineHeight: 24,
  },
  chatBubbleWrapper: {
    maxWidth: '82%',
  },
  chatBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 4,
    gap: 8,
    marginTop: 6,
  },
  chatInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
