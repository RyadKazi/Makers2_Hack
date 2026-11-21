import React from 'react';
import { Alert, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, InlineNotice, LoadingState, PageHeading } from '@/components/ui';
import { mobilityApi } from '@/api/mobility';
import { useAuth } from '@/state/auth';
import { usePreferences } from '@/state/preferences';

export default function SharingScreen() {
  const { user }=useAuth();const {t,palette,preferences}=usePreferences();const qc=useQueryClient();
  const consent=useQuery({queryKey:['mobility-consent',preferences.locale],queryFn:()=>mobilityApi.consent(preferences.locale)});
  const status=useQuery({queryKey:['mobility-current',preferences.locale],queryFn:()=>mobilityApi.current(preferences.locale),refetchInterval:30_000});
  const start=useMutation({mutationFn:async()=>{const policy=consent.data?.currentPolicy;if(!policy)throw new Error(t('backendUnavailable'));if(!consent.data?.granted||!consent.data.upToDate)await mobilityApi.grantConsent(policy.version,preferences.locale);const category=user?.accessibilityProfile?.mobility??'NONE';return mobilityApi.start(category,preferences.locale);},onSuccess:async()=>{await qc.invalidateQueries({queryKey:['mobility-current']});await qc.invalidateQueries({queryKey:['mobility-consent']});}});
  const stop=useMutation({mutationFn:()=>{const id=status.data?.session?.id;if(!id)throw new Error(t('backendUnavailable'));return mobilityApi.stop(id,preferences.locale);},onSuccess:()=>qc.invalidateQueries({queryKey:['mobility-current']})});
  const revoke=useMutation({mutationFn:()=>mobilityApi.revokeConsent(false,preferences.locale),onSuccess:()=>{qc.invalidateQueries({queryKey:['mobility-current']});qc.invalidateQueries({queryKey:['mobility-consent']});}});
  const deleteData=useMutation({mutationFn:()=>mobilityApi.deleteData(),onSuccess:()=>Alert.alert(t('privacy'),t('sharingOff'))});
  const active=status.data?.state==='ACTIVE';
  const confirmDelete=()=>Alert.alert(t('privacy'),`${t('retention')}: ${consent.data?.currentPolicy.retentionDays??30} days. Delete retained mobility data?`,[{text:t('cancel'),style:'cancel'},{text:t('clear'),style:'destructive',onPress:()=>deleteData.mutate()}]);
  if(consent.isLoading||status.isLoading)return <AppScreen><LoadingState label={t('loading')}/></AppScreen>;
  if(consent.isError||status.isError)return <AppScreen><PageHeading title={t('privacy')}/><InlineNotice tone="danger">{t('networkError')}</InlineNotice><Button title={t('retry')} variant="outline" onPress={()=>{void consent.refetch();void status.refetch();}}/></AppScreen>;
  return <AppScreen>
    <PageHeading title={t('privacy')} subtitle={t('privacyBody')}/>
    <Card style={{backgroundColor:palette.soft,borderColor:palette.soft}}><View style={{flexDirection:'row',alignItems:'center',gap:10}}><MaterialCommunityIcons name="shield-check-outline" size={26} color={palette.primary}/><AppText size={17} weight="bold" style={{flex:1}}>{t('policy')}</AppText></View><AppText size={14}>{t('consentExplain')}</AppText><AppText size={13} weight="semibold">{t('retention')}: {consent.data?.currentPolicy.retentionDays} days</AppText></Card>
    {consent.data?.currentPolicy.summary.map((item,i)=><Card key={`policy-${i}`} style={{padding:14}}><View style={{flexDirection:'row',gap:10,alignItems:'flex-start'}}><MaterialCommunityIcons name="check-circle-outline" size={19} color={palette.primary}/><AppText size={14} style={{flex:1}}>{item}</AppText></View></Card>)}
    {active&&status.data?.session?<Card><View style={{flexDirection:'row',alignItems:'center',gap:9}}><MaterialCommunityIcons name="record-circle-outline" size={22} color={palette.danger}/><AppText weight="bold" style={{flex:1}}>{t('sharingOn')}</AppText></View><AppText size={14} color={palette.muted}>{t('sessionExpires')}: {new Date(status.data.session.autoStopAt).toLocaleTimeString(preferences.locale,{hour:'2-digit',minute:'2-digit'})}</AppText><AppText size={13} color={palette.muted}>{status.data.session.pointCount} shared samples. This app does not collect background location.</AppText><Button title={t('stopSharing')} variant="danger" loading={stop.isPending} onPress={()=>stop.mutate()}/></Card>:<Card><View style={{flexDirection:'row',alignItems:'center',gap:9}}><MaterialCommunityIcons name="record-circle-outline" size={22} color={palette.muted}/><AppText weight="bold">{t('sharingOff')}</AppText></View><AppText size={14} color={palette.muted}>{t('sessionOnly')}</AppText><Button title={t('acceptAndStart')} loading={start.isPending} onPress={()=>start.mutate()} icon={<MaterialCommunityIcons name="shield-check" size={18} color={palette.primaryText}/>}/></Card>}
    <InlineNotice tone="warning">{t('noPause')} Location samples are not transmitted by this mobile build. Starting a session records your opt-in status only; a verified mobile coordinate workflow is still needed.</InlineNotice>
    {(start.isError||stop.isError||revoke.isError)?<InlineNotice tone="danger">{(start.error||stop.error||revoke.error) instanceof Error?(start.error||stop.error||revoke.error as Error).message:t('networkError')}</InlineNotice>:null}
    {consent.data?.granted?<Button title={t('sharingOff')} variant="outline" loading={revoke.isPending} onPress={()=>revoke.mutate()}/>:null}
    <Button title={t('clear')} variant="ghost" disabled={deleteData.isPending} onPress={confirmDelete}/>
    <Button title={t('close')} variant="outline" onPress={()=>router.back()}/>
  </AppScreen>;
}
