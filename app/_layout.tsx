import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotoSansKR_900Black } from '@expo-google-fonts/noto-sans-kr';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { auth } from '../firebaseConfig';
import { ProfileProvider } from '../contexts/ProfileContext';
import { PartnerProfileProvider } from '../contexts/PartnerProfileContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'NotoSansKR-Black': NotoSansKR_900Black,
    'Pretendard-Regular': require('../assets/fonts/Pretendard-Regular.otf'),
    'Pretendard-Medium': require('../assets/fonts/Pretendard-Medium.otf'),
    'Pretendard-SemiBold': require('../assets/fonts/Pretendard-SemiBold.otf'),
    'Pretendard-Bold': require('../assets/fonts/Pretendard-Bold.otf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  useEffect(() => {
    // Firebase 초기화 후 로그인 상태 복원
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        // 현재 로그인된 uid를 AsyncStorage에 저장 (기기uid/계정uid 상관없음)
        await AsyncStorage.setItem('userUid', user.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ProfileProvider>
      <PartnerProfileProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ headerShown: false }} />
        <Stack.Screen name="connect-loading" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ headerShown: false }} />
        <Stack.Screen name="connect-success" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat" options={{ headerShown: false, gestureEnabled: true, gestureDirection: 'horizontal' }} />
        <Stack.Screen name="feed-detail" options={{ headerShown: false, gestureEnabled: true, gestureDirection: 'horizontal' }} />
      </Stack>
      <StatusBar style="dark" />
      </PartnerProfileProvider>
      </ProfileProvider>
    </GestureHandlerRootView>
  );
}
