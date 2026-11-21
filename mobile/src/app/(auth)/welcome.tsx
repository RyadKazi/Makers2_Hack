import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, Card, InlineNotice } from '@/components/ui';
import { usePreferences } from '@/state/preferences';

export default function WelcomeScreen() {
  const { palette, t, isRTL } = usePreferences();
  return <AppScreen contentStyle={{flexGrow:1,justifyContent:'center',gap:24,paddingHorizontal:24}}>
    <View style={{width:64,height:64,borderRadius:21,backgroundColor:palette.soft,alignItems:'center',justifyContent:'center'}}><MaterialCommunityIcons name="map-marker-radius-outline" size={34} color={palette.primary}/></View>
    <View style={{gap:12}}><AppText size={14} weight="bold" color={palette.primary}>{t('appName')}</AppText><AppText size={38} weight="bold" accessibilityRole="header">{t('welcome')}</AppText><AppText size={17} color={palette.muted}>{t('welcomeBody')}</AppText></View>
    <Card style={{backgroundColor:palette.surfaceRaised,borderColor:palette.surfaceRaised}}><View style={{flexDirection:isRTL?'row-reverse':'row',gap:12,alignItems:'center'}}><MaterialCommunityIcons name="wheelchair" size={25} color={palette.primary}/><AppText size={14} weight="semibold" style={{flex:1}}>{t('tagline')}</AppText></View></Card>
    <Button title={t('signIn')} onPress={()=>router.push('/(auth)/login')}/>
    <Button title={t('createAccount')} variant="outline" onPress={()=>router.push('/(auth)/register')}/>
    <InlineNotice>{t('shareRouteWarning')}</InlineNotice>
  </AppScreen>;
}
