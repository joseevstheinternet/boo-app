import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { deleteField, doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';

// ─── 파티클 데이터 ────────────────────────────────────────────────────────────

const PARTICLES: {
  image: ReturnType<typeof require>;
  offsetX: number;
  offsetY: number;
  size: number;
  floatY: number;
  duration: number;
  delay: number;
}[] = [
  { image: require('../assets/images/particle-heart.png'), offsetX: 20,   offsetY: -100, size: 26, floatY: -28, duration: 2200, delay: 0   },
  { image: require('../assets/images/particle-heart.png'), offsetX: -110, offsetY: 15,   size: 30, floatY: -24, duration: 2400, delay: 400 },
  { image: require('../assets/images/particle-heart.png'), offsetX: 80,   offsetY: 80,   size: 20, floatY: -20, duration: 2000, delay: 900 },
  { image: require('../assets/images/particle-star1.png'), offsetX: -70,  offsetY: -90,  size: 18, floatY: -22, duration: 2100, delay: 200 },
  { image: require('../assets/images/particle-star2.png'), offsetX: 100,  offsetY: -30,  size: 30, floatY: -18, duration: 2300, delay: 600 },
  { image: require('../assets/images/particle-star3.png'), offsetX: 105,  offsetY: 55,   size: 22, floatY: -26, duration: 2000, delay: 300 },
  { image: require('../assets/images/particle-star1.png'), offsetX: -90,  offsetY: 70,   size: 16, floatY: -20, duration: 2500, delay: 750 },
  { image: require('../assets/images/particle-star2.png'), offsetX: -30,  offsetY: 110,  size: 18, floatY: -22, duration: 2200, delay: 550 },
  { image: require('../assets/images/particle-star3.png'), offsetX: -115, offsetY: -30,  size: 16, floatY: -18, duration: 2400, delay: 1000},
];

// ─── Particle ─────────────────────────────────────────────────────────────────

function Particle({
  image, offsetX, offsetY, size, floatY, duration, delay,
}: (typeof PARTICLES)[number]) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: duration * 0.2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: duration * 0.4, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: duration * 0.4, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(ty, { toValue: floatY, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(ty, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    }, delay);

    return () => clearTimeout(t);
  }, []);

  return (
    <Animated.Image
      source={image}
      style={[
        styles.particle,
        {
          width: size,
          height: size,
          left: offsetX - size / 2,
          top:  offsetY - size / 2,
          opacity,
          transform: [{ translateY: ty }],
        },
      ]}
      resizeMode="contain"
    />
  );
}

// ─── Ghost ────────────────────────────────────────────────────────────────────

function GhostBob() {
  const ty = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(ty, { toValue: -10, duration: 750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ty, { toValue: 0,   duration: 750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.Image
      source={require('../assets/images/icon-chat.png')}
      style={[styles.ghost, { transform: [{ translateY: ty }] }]}
      resizeMode="contain"
    />
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ConnectLoadingScreen() {
  const [statusLabel, setStatusLabel] = useState('연결 중이에요');

  useEffect(() => {
    let unsub: (() => void) | null = null;

    async function setup() {
      const cid = await AsyncStorage.getItem('coupleId');
      if (!cid) return;

      const uid =
        auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';

      unsub = onSnapshot(doc(db, 'couples', cid), async snap => {
        if (!snap.exists()) return;
        const data = snap.data();

        if (data.user1Ready && data.user2Ready) {
          unsub?.();
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.replace('/connect-success');
        } else {
          const myRole = data.user1 === uid ? 'user1' : 'user2';
          const myReady: boolean = data[`${myRole}Ready`] ?? false;
          if (myReady) {
            setStatusLabel('상대방이 프로필을 설정하고 있어요');
          }
        }
      }, _e => {});
    }

    setup();
    return () => unsub?.();
  }, []);

  async function handleCancel() {
    Alert.alert('연결 취소', '연결을 취소할까요?', [
      { text: '아니요', style: 'cancel' },
      {
        text: '네',
        style: 'destructive',
        onPress: async () => {
          const cid = await AsyncStorage.getItem('coupleId');
          const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
          if (cid) {
            await updateDoc(doc(db, 'couples', cid), {
              user1Ready: false,
              user2Ready: false,
            });
            const coupleSnap = await getDoc(doc(db, 'couples', cid));
            const users: string[] = coupleSnap.exists() ? (coupleSnap.data().users ?? []) : [];
            await Promise.all(users.map(u =>
              updateDoc(doc(db, 'users', u), {
                coupleId: deleteField(),
                partnerId: deleteField(),
              })
            ));
          }
          await AsyncStorage.multiRemove(['coupleId', 'coupleRole', 'setupComplete', 'myInviteCode']);
          router.replace('/connect');
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.scene}>
        {PARTICLES.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
        <View style={styles.ghostWrap}>
          <GhostBob />
        </View>
      </View>

      <Text style={styles.label}>{statusLabel}</Text>
      <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>연결 취소하기</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GHOST_SIZE = 51;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scene: {
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
  },
  ghostWrap: {
    position: 'absolute',
    left:  -GHOST_SIZE / 2,
    top:   -GHOST_SIZE / 2,
  },
  ghost: {
    width:  GHOST_SIZE,
    height: GHOST_SIZE,
  },
  label: {
    marginTop: 80,
    fontFamily: 'Pretendard-Medium',
    fontSize: 15,
    color: '#F17088',
    letterSpacing: 0.5,
  },
  cancelBtn: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  cancelText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#C4A0A8',
    textDecorationLine: 'underline',
  },
});
