import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppScreen, AppText, Button, InlineNotice, TextField } from '@/components/ui';
import { toUserFacingError, useAuth } from '@/state/auth';
import { usePreferences } from '@/state/preferences';

export default function LoginScreen() {
  const { signIn } = useAuth(); const { t, palette, isRTL } = usePreferences();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [resetInfo,setResetInfo]=useState(false);
  const submit=async()=>{setError('');setBusy(true);try{await signIn(email.trim(),password);router.replace('/(tabs)');}catch(e){setError(toUserFacingError(e,t('networkError')));}finally{setBusy(false);}};
  return <AppScreen contentStyle={{flexGrow:1,justifyContent:'center',gap:18}}>
    <View style={{gap:8}}><AppText size={32} weight="bold" accessibilityRole="header">{t('signInTitle')}</AppText><AppText color={palette.muted}>{t('welcomeBody')}</AppText></View>
    <TextField label={t('email')} value={email} onChangeText={setEmail} placeholder="student@university.edu" autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next"/>
    <TextField label={t('password')} value={password} onChangeText={setPassword} placeholder="••••••••••" secureTextEntry textContentType="password" onSubmitEditing={submit}/>
    {error?<InlineNotice tone="danger">{error}</InlineNotice>:null}{resetInfo?<InlineNotice tone="warning">{t('resetUnavailable')}</InlineNotice>:null}
    <Pressable accessibilityRole="button" accessibilityLabel={t('forgotPassword')} onPress={()=>setResetInfo(true)} style={{alignSelf:isRTL?'flex-start':'flex-end',paddingVertical:7}}><AppText size={14} weight="semibold" color={palette.primary}>{t('forgotPassword')}</AppText></Pressable>
    <Button title={t('signIn')} onPress={submit} loading={busy} disabled={!email.trim()||!password}/>
    <View style={{flexDirection:isRTL?'row-reverse':'row',justifyContent:'center',gap:6}}><AppText color={palette.muted}>{t('noAccount')}</AppText><Pressable onPress={()=>router.replace('/(auth)/register')} accessibilityRole="link"><AppText weight="bold" color={palette.primary}>{t('createAccount')}</AppText></Pressable></View>
  </AppScreen>;
}
