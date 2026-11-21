import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, InlineNotice, PageHeading } from '@/components/ui';
import { usePreferences } from '@/state/preferences';
import { speechToTextService } from '@/services/speech/stt';
import type { Locale } from '@/types/api';

const localeOptions:{id:Locale;label:string}[]=[{id:'en',label:'English'},{id:'fr',label:'Français'},{id:'ar',label:'العربية'}];
const samples:Record<Locale,string>={en:'This is a sample transcript for demonstration. Real speech recognition is not connected.',fr:'Ceci est un exemple de transcription. La reconnaissance vocale réelle n’est pas connectée.',ar:'هذا نص تجريبي للعرض. لم يتم ربط التعرف الحقيقي على الكلام.'};

export default function SpeechToTextScreen(){const {t,palette,preferences,setPreference,isRTL}=usePreferences();const [locale,setLocale]=useState<Locale>(preferences.locale);const [state,setState]=useState<'idle'|'recording'|'done'>('idle');const [text,setText]=useState('');const [copied,setCopied]=useState(false);
  const start=async()=>{setState('recording');setText('');setCopied(false);const result=await speechToTextService.startDemo(locale);if(result){setText(result);setState('done');}else setState('idle');};
  const stop=()=>{speechToTextService.stop();setState('idle');};const copy=async()=>{if(text){await Clipboard.setStringAsync(text);setCopied(true);}};
  return <AppScreen>
    <PageHeading title={t('speechToText')} subtitle={t('prototype')}/>
    <InlineNotice tone="warning">{t('demoNotice')}</InlineNotice>
    <Card style={{alignItems:'center',paddingVertical:24,gap:15}}>
      <Pressable accessibilityRole="button" accessibilityLabel={state==='recording'?t('stopDemo'):t('startDemo')} accessibilityState={{busy:state==='recording'}} onPress={state==='recording'?stop:start} style={({pressed})=>({width:94,height:94,borderRadius:47,backgroundColor:state==='recording'?palette.accent:palette.primary,alignItems:'center',justifyContent:'center',opacity:pressed?0.84:1})}><MaterialCommunityIcons name={state==='recording'?'stop':'microphone'} size={37} color={palette.primaryText}/></Pressable>
      <AppText size={18} weight="bold">{state==='recording'?t('recording'):state==='done'?t('speechToText'):t('startDemo')}</AppText>
      <AppText size={13} color={palette.muted}>{state==='recording'?'Playing a simulated recording state. No microphone permission is requested.':t('demoNotice')}</AppText>
      <Button title={state==='recording'?t('stopDemo'):t('startDemo')} onPress={state==='recording'?stop:start} variant={state==='recording'?'danger':'primary'}/>
    </Card>
    <View style={{gap:9}}><AppText weight="semibold">{t('language')}</AppText><View style={{flexDirection:isRTL?'row-reverse':'row',flexWrap:'wrap',gap:8}}>{localeOptions.map(item=><Chip key={item.id} label={item.label} selected={locale===item.id} onPress={()=>{setLocale(item.id);void setPreference('locale',item.id);}}/>)}</View></View>
    <Card style={{minHeight:160}}><AppText size={12} weight="bold" color={palette.primary}>{t('prototype')}</AppText><AppText size={16}>{text||t('transcriptPlaceholder')}</AppText></Card>
    {state==='done'?<InlineNotice tone="info">{samples[locale]}</InlineNotice>:null}
    <View style={{flexDirection:isRTL?'row-reverse':'row',gap:9}}><Button title={copied?t('copied'):t('copy')} variant="outline" disabled={!text} onPress={copy} style={{flex:1}}/><Button title={t('clear')} variant="ghost" onPress={()=>{setText('');setState('idle');}} style={{flex:1}}/></View>
    <Button title={t('close')} variant="ghost" onPress={()=>router.back()}/>
  </AppScreen>;
}
