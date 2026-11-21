import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, InlineNotice, TextField } from '@/components/ui';
import { toUserFacingError, useAuth } from '@/state/auth';
import { usePreferences } from '@/state/preferences';

export default function RegisterScreen() {
  const { register }=useAuth(); const { t, palette, preferences, isRTL }=usePreferences();
  const [name,setName]=useState('');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const submit=async()=>{setError('');setBusy(true);try{await register(name.trim(),email.trim(),password,preferences.locale);router.replace('/(tabs)');}catch(e){setError(toUserFacingError(e,t('networkError')));}finally{setBusy(false);}};
  return <AppScreen contentStyle={{flexGrow:1,justifyContent:'center',gap:17}}>
    <View style={{gap:8}}><AppText size={30} weight="bold" accessibilityRole="header">{t('registerTitle')}</AppText><AppText color={palette.muted}>{t('welcomeBody')}</AppText></View>
    <TextField label={t('displayName')} value={name} onChangeText={setName} autoComplete="name" textContentType="name"/>
    <TextField label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"/>
    <TextField label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword"/>
    <AppText size={13} color={palette.muted}>Use at least 10 characters.</AppText>
    {error?<InlineNotice tone="danger">{error}</InlineNotice>:null}
    <Button title={t('createAccount')} onPress={submit} loading={busy} disabled={name.trim().length<2||!email.includes('@')||password.length<10}/>
    <View style={{flexDirection:isRTL?'row-reverse':'row',justifyContent:'center',gap:6}}><AppText color={palette.muted}>{t('haveAccount')}</AppText><Pressable onPress={()=>router.replace('/(auth)/login')} accessibilityRole="link"><AppText weight="bold" color={palette.primary}>{t('signIn')}</AppText></Pressable></View>
  </AppScreen>;
}
