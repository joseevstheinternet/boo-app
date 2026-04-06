import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { useEffect, useRef } from 'react';
import { Animated, ImageBackground, StyleSheet } from 'react-native';
import BunyEye from '../assets/images/buny-eye.svg';
import { auth } from '../firebaseConfig';

export default function SplashScreen() {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // ── 1. 로그인 상태 확인 ──────────────────────────────────────────
      try {
        const user = await new Promise<import('firebase/auth').User | null>((resolve, reject) => {
          const unsub = onAuthStateChanged(
            auth,
            u => { unsub(); resolve(u); },
            err => { unsub(); reject(err); },
          );
        });

        if (user) {
          await AsyncStorage.setItem('userUid', user.uid);
        } else {
          // 세션 없음 → signInAnonymously 1회
          const cachedUid = await AsyncStorage.getItem('userUid');
          if (!cachedUid) {
            const cred = await signInAnonymously(auth);
            await AsyncStorage.setItem('userUid', cred.user.uid);
          }
          // cachedUid 있는데 auth null = Expo Go 엣지케이스 → 재로그인
          else {
            const cred = await signInAnonymously(auth);
            await AsyncStorage.setItem('userUid', cred.user.uid);
          }
        }
      } catch (e: any) {
        // auth init error silently ignored — continue with AsyncStorage uid
      }

      if (cancelled) return;

      // ── 2. 라우팅 결정 ───────────────────────────────────────────────
      try {
        const coupleId = await AsyncStorage.getItem('coupleId');
        const done =
          (await AsyncStorage.getItem('setupComplete')) ??
          (await AsyncStorage.getItem('profileComplete'));

        if (coupleId && done) {
          router.replace('/(tabs)/home');
        } else if (coupleId) {
          router.replace('/setup');
        } else {
          router.replace('/connect');
        }
      } catch {
        router.replace('/connect');
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return (
    <ImageBackground
      source={require('../assets/images/splash-bg.png')}
      style={styles.container}
      resizeMode="cover"
    >
      <Animated.View style={[styles.eyeWrapper, {
        transform: [
          { translateX: floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) },
          { translateY: floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -50] }) },
        ]
      }]}>
        <BunyEye width={102} height={49} />
      </Animated.View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeWrapper: {
    position: 'absolute',
    bottom: 80,
    right: 150,
  },
});
