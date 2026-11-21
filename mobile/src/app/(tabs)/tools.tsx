import React from 'react';
import { Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppScreen, AppText, Card, PageHeading } from '@/components/ui';
import { usePreferences } from '@/state/preferences';

export default function ToolsScreen(){const {t,palette,isRTL}=usePreferences();return <AppScreen>
  <PageHeading title={t('toolsTitle')} subtitle={t('toolsBody')}/>
  <ToolCard icon="microphone-message" title={t('speechToText')} subtitle={t('demoNotice')} tag={t('prototype')} onPress={()=>router.push('/speech-to-text')} palette={palette} rtl={isRTL}/>
  <ToolCard icon="text-to-speech" title={t('textToSpeech')} subtitle={t('playbackDemo')} tag={t('prototype')} onPress={()=>router.push('/text-to-speech')} palette={palette} rtl={isRTL}/>
  <ToolCard icon="tune-variant" title={t('preferences')} subtitle={t('preferencesBody')} onPress={()=>router.push('/accessibility-settings')} palette={palette} rtl={isRTL}/>
</AppScreen>;}

function ToolCard({icon,title,subtitle,tag,onPress,palette,rtl}:{icon:string;title:string;subtitle:string;tag?:string;onPress:()=>void;palette:any;rtl:boolean}){return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}><Card style={{flexDirection:rtl?'row-reverse':'row',alignItems:'center'}}><View style={{width:50,height:50,borderRadius:16,backgroundColor:palette.soft,alignItems:'center',justifyContent:'center'}}><MaterialCommunityIcons name={icon as any} size={25} color={palette.primary}/></View><View style={{flex:1,gap:4}}><AppText weight="bold">{title}</AppText><AppText size={13} color={palette.muted}>{subtitle}</AppText></View>{tag?<AppText size={11} weight="bold" color={palette.warning}>{tag}</AppText>:<MaterialCommunityIcons name="chevron-right" size={23} color={palette.muted}/>}</Card></Pressable>;}
