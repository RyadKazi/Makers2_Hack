import React from 'react';
import { Alert, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, PageHeading, SectionTitle } from '@/components/ui';
import { useAuth } from '@/state/auth';
import { usePreferences } from '@/state/preferences';

export default function ProfileScreen(){const {user,signOut}=useAuth();const {t,palette}=usePreferences();
  const logout=()=>Alert.alert(t('signOut'),t('signOut'),[{text:t('cancel'),style:'cancel'},{text:t('signOut'),style:'destructive',onPress:()=>void signOut()}]);
  return <AppScreen>
    <PageHeading title={t('profileTitle')}/>
    <Card style={{alignItems:'center',paddingVertical:24}}><View style={{width:72,height:72,borderRadius:24,backgroundColor:palette.soft,alignItems:'center',justifyContent:'center'}}><MaterialCommunityIcons name="account-outline" size={39} color={palette.primary}/></View><AppText size={22} weight="bold">{user?.displayName}</AppText><AppText color={palette.muted}>{user?.email}</AppText><AppText size={13} color={palette.muted}>{user?.role}</AppText></Card>
    <SectionTitle title={t('university')}/><Card><AppText weight="semibold">{user?.locale.toUpperCase()} · {t('appLanguage')}</AppText><AppText size={14} color={palette.muted}>{t('faculty')}</AppText></Card>
    <Button title={t('preferences')} variant="outline" onPress={()=>router.push('/accessibility-settings')} icon={<MaterialCommunityIcons name="tune-variant" size={19} color={palette.text}/>}/>
    <Button title={t('privacy')} variant="outline" onPress={()=>router.push('/sharing')} icon={<MaterialCommunityIcons name="shield-lock-outline" size={19} color={palette.text}/>}/>
    <SectionTitle title={t('accountSettings')}/>
    <Button title={t('signOut')} variant="danger" onPress={logout} icon={<MaterialCommunityIcons name="logout" size={18} color="#FFFFFF" />}/>
  </AppScreen>;
}
