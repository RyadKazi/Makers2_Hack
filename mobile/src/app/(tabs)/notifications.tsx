import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppScreen, AppText, Card, PageHeading } from '@/components/ui';
import { usePreferences } from '@/state/preferences';

export default function NotificationsScreen(){
  const {t,palette}=usePreferences();
  return <AppScreen>
    <PageHeading title={t('notificationsTitle')}/>
    <Card style={{alignItems:'center',paddingVertical:30,gap:12}}>
      <View style={{width:68,height:68,borderRadius:24,backgroundColor:palette.soft,alignItems:'center',justifyContent:'center'}}>
        <MaterialCommunityIcons name="bell-outline" size={34} color={palette.primary}/>
      </View>
      <AppText size={18} weight="bold" accessibilityRole="header">{t('backendUnavailable')}</AppText>
      <AppText color={palette.muted} style={{textAlign:'center'}}>{t('notificationsUnavailable')}</AppText>
    </Card>
  </AppScreen>;
}
