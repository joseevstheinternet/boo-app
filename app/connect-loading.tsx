import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { deleteField, doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { auth, db } from '../firebaseConfig';

// ─── 파티클 데이터 ────────────────────────────────────────────────────────────
// offsetX/Y: 씬 중앙(유령 위치)으로부터의 초기 좌표 오프셋
// floatY: 위로 이동할 거리 (음수 = 위)
// duration: 1 사이클 ms
// delay: 시작 지연 ms (stagger)

const PARTICLES: {
  image: ReturnType<typeof require>;
  offsetX: number;
  offsetY: number;
  size: number;
  floatY: number;
  duration: number;
  delay: number;
}[] = [
  // 핑크 하트
  { image: require('../assets/images/particle-heart.png'), offsetX: 20,   offsetY: -100, size: 26, floatY: -28, duration: 2200, delay: 0   },
  { image: require('../assets/images/particle-heart.png'), offsetX: -110, offsetY: 15,   size: 30, floatY: -24, duration: 2400, delay: 400 },
  { image: require('../assets/images/particle-heart.png'), offsetX: 80,   offsetY: 80,   size: 20, floatY: -20, duration: 2000, delay: 900 },
  // 노란 별
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
  const opacity = useSharedValue(0);
  const ty = useSharedValue(0);

  useEffect(() => {
    const t = setTimeout(() => {
      // 위로 떠오르며 사라지는 루프
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: duration * 0.2, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: duration * 0.4 }),
          withTiming(0, { duration: duration * 0.4, easing: Easing.in(Easing.quad) }),
        ),
        -1,
      );
      ty.value = withRepeat(
        withSequence(
          withTiming(floatY, { duration: duration, easing: Easing.inOut(Easing.quad) }),
          withTiming(0,      { duration: 0 }),
        ),
        -1,
      );
    }, delay);

    return () => clearTimeout(t);
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }],
  }));

  return (
    <Animated.Image
      source={image}
      style={[
        styles.particle,
        {
          width: size,
          height: size,
          // 씬 중앙(0,0) 기준으로 배치 — 이미지 자신의 크기만큼 오프셋 보정
          left: offsetX - size / 2,
          top:  offsetY - size / 2,
        },
        animStyle,
      ]}
      resizeMode="contain"
    />
  );
}

// ─── Ghost ────────────────────────────────────────────────────────────────────

function GhostBob() {
  const ty = useSharedValue(0);

  useEffect(() => {
    ty.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 750, easing: Easing.inOut(Easing.sin) }),
        withTiming(0,   { duration: 750, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  return (
    <Animated.Image
      source={require('../assets/images/icon-chat.png')}
      style={[styles.ghost, animStyle]}
      resizeMode="contain"
    />
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ConnectLoadingScreen() {
  const [statusLabel, setStatusLabel] = useState('연결 중이에요');

  // Firestore 폴링: user1Ready && user2Ready 둘 다 true 되면 home 으로 이동
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
            // 커플 문서에서 ready 초기화
            await updateDoc(doc(db, 'couples', cid), {
              user1Ready: false,
              user2Ready: false,
            });
            // 두 유저 문서에서 coupleId/partnerId 제거
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
      {/*
        씬: 파티클이 유령 주위에 절대 좌표로 배치되는 기준 컨테이너.
        width/height 0 → 부모 중앙에 포인트를 만들고, 파티클은 그 점 기준으로 offset.
      */}
      <View style={styles.scene}>
        {PARTICLES.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
        {/* 유령은 씬 중앙(0,0)에서 자신 크기만큼 보정 */}
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

  // 파티클 + 유령의 기준점 (크기 0의 앵커 뷰)
  scene: {
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 파티클: scene 기준 절대 좌표
  particle: {
    position: 'absolute',
  },

  // 유령: scene 중앙에서 자신 크기만큼 오프셋 보정
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
    marginTop: 80,         // scene이 0x0이므로 유령 크기 + 여백 반영
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
