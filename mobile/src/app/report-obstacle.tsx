import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppScreen, AppText, Button, Card, Chip, InlineNotice, PageHeading, TextField } from '@/components/ui';
import { mobilityApi } from '@/api/mobility';
import { usePreferences } from '@/state/preferences';
import type { DifficultyType } from '@/types/api';

const categories:{type:DifficultyType;key:'blocked'|'tooSteep'|'difficult';icon:string}[]=[{type:'BLOCKED',key:'blocked',icon:'road-variant'},{type:'TOO_STEEP',key:'tooSteep',icon:'stairs'},{type:'HARD_TO_NAVIGATE',key:'difficult',icon:'alert-circle-outline'}];

export default function ReportObstacleScreen(){
  const params=useLocalSearchParams<{x?:string;y?:string;floorId?:string;level?:string}>();const {t,palette,preferences}=usePreferences();const qc=useQueryClient();
  const [category,setCategory]=useState<DifficultyType>('HARD_TO_NAVIGATE');const [note,setNote]=useState('');const [error,setError]=useState('');
  const session=useQuery({queryKey:['mobility-current',preferences.locale],queryFn:()=>mobilityApi.current(preferences.locale)});
  const x=Number(params.x),y=Number(params.y),level=Number(params.level);const hasLocation=Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(level)&&!!params.floorId;
  const send=useMutation({mutationFn:()=>{if(!session.data?.session?.id)throw new Error(t('signInRequired'));if(!hasLocation)throw new Error(t('pickLocation'));return mobilityApi.report({sessionId:session.data.session.id,type:category,note:note.trim()||undefined,x,y,level,floorId:params.floorId,recordedAt:new Date().toISOString()},preferences.locale);},onSuccess:async()=>{await qc.invalidateQueries({queryKey:['mobility-current']});Alert.alert(t('reportSuccess'),t('obstacleBody'),[{text:t('close'),onPress:()=>router.back()}]);}});
  return <AppScreen>
    <PageHeading title={t('obstacleTitle')} subtitle={t('obstacleBody')}/>
    <Card><AppText weight="bold">{t('obstacleType')}</AppText><View style={{gap:9}}>{categories.map(item=><Chip key={item.type} label={t(item.key)} selected={category===item.type} onPress={()=>setCategory(item.type)}/>)}</View>
      <AppText weight="semibold">{t('location')}</AppText>
      {hasLocation?<View style={{flexDirection:'row',alignItems:'center',gap:9}}><MaterialCommunityIcons name="map-marker-check-outline" size={20} color={palette.primary}/><AppText size={14}>{t('chooseFloor')} {level} · {x.toFixed(1)}, {y.toFixed(1)}</AppText></View>:<><AppText size={14} color={palette.muted}>{t('pickLocation')}</AppText><Button title={t('pickLocation')} variant="outline" onPress={()=>router.push({pathname:'/(tabs)/map',params:{pickLocation:'1',returnTo:'report'}})}/></>}
      <TextField label={t('description')} value={note} onChangeText={setNote} placeholder={t('description')} multiline maxLength={280} inputStyle={{minHeight:96,textAlignVertical:'top'}}/>
      <InlineNotice>{t('photoUnavailable')}</InlineNotice>
    </Card>
    {!session.isLoading&&session.data?.state!=='ACTIVE'?<Card><AppText weight="bold">{t('sharingOff')}</AppText><AppText size={14} color={palette.muted}>The current API requires an active voluntary session before it accepts a difficulty report.</AppText><Button title={t('reviewConsent')} variant="outline" onPress={()=>router.push('/sharing')}/></Card>:null}
    {error||send.isError?<InlineNotice tone="danger">{error||(send.error instanceof Error?send.error.message:t('networkError'))}</InlineNotice>:null}
    <Button title={t('sendReport')} onPress={()=>{setError('');send.mutate();}} loading={send.isPending} disabled={!hasLocation||session.data?.state!=='ACTIVE'}/>
    <AppText size={12} color={palette.muted}>Reports are submitted for review. AccesU does not mark them verified.</AppText>
    <Button title={t('close')} variant="ghost" onPress={()=>router.back()}/>
  </AppScreen>;
}
