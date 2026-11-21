import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, Chip, InlineNotice, PageHeading, SwitchRow, TextField } from '@/components/ui';
import { authApi } from '@/api/auth';
import { useAuth, toUserFacingError } from '@/state/auth';
import { usePreferences, type ThemeMode } from '@/state/preferences';
import type { AccessibilityProfile, MobilityProfile } from '@/types/api';

const mobilityOptions:{key:MobilityProfile;label:string}[]=[{key:'NONE',label:'No mobility profile'},{key:'WHEELCHAIR',label:'Wheelchair'},{key:'REDUCED_MOBILITY',label:'Reduced mobility'},{key:'BLIND_LOW_VISION',label:'Blind or low vision'},{key:'DEAF_HARD_OF_HEARING',label:'Deaf or hard of hearing'},{key:'SPEECH',label:'Speech preference'}];

export default function AccessibilitySettingsScreen(){
  const {user,refreshUser}=useAuth();const {t,palette,preferences,setPreference}=usePreferences();const qc=useQueryClient();
  const [error,setError]=useState('');const [slope,setSlope]=useState(user?.accessibilityProfile.maxSlopePercent?.toString()??'');const [width,setWidth]=useState(user?.accessibilityProfile.minPassageWidthCm?.toString()??'');
  // Keep editable numeric fields in sync when the profile is refreshed from the server.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{setSlope(user?.accessibilityProfile.maxSlopePercent?.toString()??'');setWidth(user?.accessibilityProfile.minPassageWidthCm?.toString()??'');},[user?.accessibilityProfile.maxSlopePercent,user?.accessibilityProfile.minPassageWidthCm]);
  const update=useMutation({mutationFn:(body:Partial<AccessibilityProfile>)=>authApi.updateAccessibility(body),onSuccess:async()=>{setError('');await refreshUser();await qc.invalidateQueries({queryKey:['profile']});}});
  const save=(body:Partial<AccessibilityProfile>)=>{setError('');update.mutate(body);};
  const changeLocale=async(locale:'en'|'fr'|'ar')=>{await setPreference('locale',locale);try{await authApi.updateMe({locale});await refreshUser();}catch(e){setError(toUserFacingError(e,t('networkError')));}};
  const profile=user?.accessibilityProfile;
  return <AppScreen>
    <PageHeading title={t('preferences')} subtitle={t('preferencesBody')}/>
    <Card><AppText weight="bold">{t('mobilityNeeds')}</AppText><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{mobilityOptions.map(item=><Chip key={item.key} label={item.label} selected={profile?.mobility===item.key} onPress={()=>save({mobility:item.key})}/>)}</View>
      <SwitchRow title={t('stepFree')} value={!!profile?.stepFree} onValueChange={value=>save({stepFree:value})}/>
      <SwitchRow title={t('verifiedRamps')} value={!!profile?.requireVerifiedRamps} onValueChange={value=>save({requireVerifiedRamps:value})}/>
      <SwitchRow title={t('audioGuidance')} value={!!profile?.audioGuidance} onValueChange={value=>save({audioGuidance:value})}/>
      <SwitchRow title={t('shoreline')} value={!!profile?.shorelineHints} onValueChange={value=>save({shorelineHints:value})}/>
      <SwitchRow title={t('captions')} value={!!profile?.captions} onValueChange={value=>save({captions:value})}/>
      <SwitchRow title={t('textToSpeechPref')} value={!!profile?.textToSpeech} onValueChange={value=>save({textToSpeech:value})}/>
      <TextField label={t('slopeLimit')} value={slope} onChangeText={setSlope} keyboardType="decimal-pad" onBlur={()=>save({maxSlopePercent:slope?Number(slope):null})}/>
      <TextField label={t('widthLimit')} value={width} onChangeText={setWidth} keyboardType="number-pad" onBlur={()=>save({minPassageWidthCm:width?Number(width):null})}/>
    </Card>
    <Card><AppText weight="bold">{t('appearance')}</AppText><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['system','warm','light','dark','hc'] as ThemeMode[]).map(mode=><Chip key={mode} label={t(mode as any)} selected={preferences.theme===mode} onPress={()=>void setPreference('theme',mode)}/>)}</View>
      <SwitchRow title={t('highContrast')} value={preferences.highContrast} onValueChange={value=>{void setPreference('highContrast',value);save({highContrast:value});}}/>
      <SwitchRow title={t('reducedMotion')} value={preferences.reducedMotion} onValueChange={value=>{void setPreference('reducedMotion',value);save({reducedMotion:value});}}/>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><AppText weight="semibold">{t('largerText')} · {preferences.textScale.toFixed(1)}×</AppText><View style={{flexDirection:'row',gap:8}}><Button title="−" variant="outline" onPress={()=>{const value=Math.max(1,Math.round((preferences.textScale-.1)*10)/10);void setPreference('textScale',value);save({textScale:value});}} style={{minHeight:42,minWidth:48}}/><Button title="+" variant="outline" onPress={()=>{const value=Math.min(2,Math.round((preferences.textScale+.1)*10)/10);void setPreference('textScale',value);save({textScale:value});}} style={{minHeight:42,minWidth:48}}/></View></View>
    </Card>
    <Card><AppText weight="bold">{t('appLanguage')}</AppText><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{([{id:'en',label:t('english')},{id:'fr',label:t('french')},{id:'ar',label:t('arabic')}] as const).map(item=><Chip key={item.id} label={item.label} selected={preferences.locale===item.id} onPress={()=>void changeLocale(item.id)}/>)}</View></Card>
    {update.isPending?<InlineNotice>{t('loading')}</InlineNotice>:null}{error?<InlineNotice tone="danger">{error}</InlineNotice>:null}
    <InlineNotice>{t('shareRouteWarning')}</InlineNotice>
    <Button title={t('close')} variant="outline" onPress={()=>router.back()} icon={<MaterialCommunityIcons name="arrow-left" size={18} color={palette.text}/>}/>
  </AppScreen>;
}
