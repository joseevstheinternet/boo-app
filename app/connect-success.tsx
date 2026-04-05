import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  Dimensions, Image, Text,
  TouchableOpacity, View,
} from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue,
  withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../firebaseConfig';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── 파티클 데이터 ────────────────────────────────────────────────────────────

const ICONS = ['heart', 'heart-outline', 'sparkles', 'star', 'rose'] as const;
const COLORS = ['#F17088', '#FFB6C4', '#FF8FA3', '#F17088', '#FFC0CB'];

interface ParticleData {
  tx: number;
  ty: number;
  duration: number;
  delay: number;
  size: number;
  icon: string;
  color: string;
}

// 24개 파티클을 균등 각도 + 약간의 지터로 생성 (모듈 로드 시 1회)
const PARTICLES: ParticleData[] = Array.from({ length: 24 }, (_, i) => {
  const baseAngle = (i / 24) * 2 * Math.PI;
  const jitter    = (Math.random() - 0.5) * (Math.PI / 10);
  const angle     = baseAngle + jitter;
  const distance  = 110 + Math.random() * 90;   // 110~200px
  return {
    tx:       Math.cos(angle) * distance,
    ty:       Math.sin(angle) * distance,
    duration: 800 + Math.random() * 400,          // 800~1200ms
    delay:    Math.random() * 120,                // 0~120ms 스태거
    size:     10 + Math.random() * 10,            // 10~20px
    icon:     ICONS[i % ICONS.length],
    color:    COLORS[i % COLORS.length],
  };
});

// 화면 중앙 기준점 (프로필 영역 수직 중심)
const BURST_LEFT = SW / 2;
const BURST_TOP  = SH * 0.42;

// ─── Particle ────────────────────────────────────────────────────────────────

function Particle({ tx, ty, duration, delay, size, icon, color }: ParticleData) {
  const opacity    = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale      = useSharedValue(1);

  useEffect(() => {
    const easeOut = Easing.out(Easing.cubic);

    // 페이드: 빠르게 등장 → 천천히 소멸
    opacity.value = withDelay(
      delay,
      withSequence(
        withTiming(1,   { duration: duration * 0.15 }),
        withTiming(0,   { duration: duration * 0.85, easing: Easing.in(Easing.quad) }),
      ),
    );
    // 방사형 이동
    translateX.value = withDelay(delay, withTiming(tx, { duration, easing: easeOut }));
    translateY.value = withDelay(delay, withTiming(ty, { duration, easing: easeOut }));
    // 크기 축소: 1 → 0.3
    scale.value = withDelay(delay, withTiming(0.3, { duration, easing: easeOut }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: BURST_LEFT - size / 2,
          top:  BURST_TOP  - size / 2,
        },
        animStyle,
      ]}
    >
      <Ionicons name={icon as any} size={size} color={color} />
    </Animated.View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ConnectSuccessScreen() {
  const [myNickname, setMyNickname]           = useState('');
  const [myImage, setMyImage]                 = useState('');
  const [partnerNickname, setPartnerNickname] = useState('');
  const [partnerImage, setPartnerImage]       = useState('');

  // 애니메이션
  const profileOpacity = useSharedValue(0);
  const profileY       = useSharedValue(20);
  const heartScale     = useSharedValue(0);
  const textOpacity    = useSharedValue(0);
  const textY          = useSharedValue(16);
  const btnOpacity     = useSharedValue(0);
  const btnY           = useSharedValue(16);

  const profileAnimStyle = useAnimatedStyle(() => ({
    opacity:   profileOpacity.value,
    transform: [{ translateY: profileY.value }],
  }));
  const heartAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));
  const textAnimStyle = useAnimatedStyle(() => ({
    opacity:   textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const btnAnimStyle = useAnimatedStyle(() => ({
    opacity:   btnOpacity.value,
    transform: [{ translateY: btnY.value }],
  }));

  useEffect(() => {
    loadData();

    // 1. 프로필 영역
    profileOpacity.value = withDelay(200, withTiming(1, { duration: 600 }));
    profileY.value       = withDelay(200, withTiming(0, { duration: 600 }));

    // 2. 하트 + 햅틱 + 파티클 버스트 동시
    heartScale.value = withDelay(
      400,
      withSequence(
        withSpring(1.2, { stiffness: 200, damping: 10 }),
        withSpring(1,   { stiffness: 200, damping: 15 }),
      ),
    );
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 400);

    // 3. 텍스트
    textOpacity.value = withDelay(700, withTiming(1, { duration: 500 }));
    textY.value       = withDelay(700, withTiming(0, { duration: 500 }));

    // 4. 버튼
    btnOpacity.value = withDelay(900, withTiming(1, { duration: 500 }));
    btnY.value       = withDelay(900, withTiming(0, { duration: 500 }));
  }, []);

  async function loadData() {
    const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
    const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
    if (!uid || !cid) return;

    const [mySnap, coupleSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid)),
      getDoc(doc(db, 'couples', cid)),
    ]);

    if (mySnap.exists()) {
      setMyNickname(mySnap.data().nickname ?? '');
      setMyImage(mySnap.data().profileImage ?? '');
    }

    if (coupleSnap.exists()) {
      const users: string[] = coupleSnap.data().users ?? [];
      const partnerUid = users.find(u => u !== uid);
      if (partnerUid) {
        const pSnap = await getDoc(doc(db, 'users', partnerUid));
        if (pSnap.exists()) {
          setPartnerNickname(pSnap.data().nickname ?? '');
          setPartnerImage(pSnap.data().profileImage ?? '');
        }
      }
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#2F2F2F' }}>

      {/* 파티클 버스트 레이어 (터치 이벤트 통과) */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        pointerEvents="none"
      >
        {PARTICLES.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </View>

      {/* 메인 콘텐츠 */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 40 }}>

        {/* 프로필 행 */}
        <Animated.View style={profileAnimStyle}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>

            {/* 내 프로필 */}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Image
                source={myImage ? { uri: myImage } : require('../assets/images/profile-default.png')}
                style={{
                  width: 72, height: 72, borderRadius: 36,
                  borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
                }}
              />
              <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12,
                color: 'rgba(255,255,255,0.5)', letterSpacing: -0.1 }}>
                {myNickname || '?'}
              </Text>
            </View>

            {/* 중앙 하트 */}
            <Animated.View style={heartAnimStyle}>
              <Ionicons name="heart" size={32} color="#F17088" />
            </Animated.View>

            {/* 상대방 프로필 */}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Image
                source={partnerImage ? { uri: partnerImage } : require('../assets/images/profile-default.png')}
                style={{
                  width: 72, height: 72, borderRadius: 36,
                  borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
                }}
              />
              <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12,
                color: 'rgba(255,255,255,0.5)', letterSpacing: -0.1 }}>
                {partnerNickname || '?'}
              </Text>
            </View>

          </View>
        </Animated.View>

        {/* 텍스트 */}
        <Animated.View style={[{ alignItems: 'center', gap: 12 }, textAnimStyle]}>
          <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 24,
            color: '#fff', letterSpacing: -0.24 }}>
            드디어 만났어요!
          </Text>
          <View style={{ alignItems: 'center', gap: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12,
                color: '#F17088', letterSpacing: -0.1 }}>
                {partnerNickname}
              </Text>
              <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12,
                color: 'rgba(255,255,255,0.5)', letterSpacing: -0.1 }}>
                님과 연결됐어요
              </Text>
            </View>
            <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12,
              color: 'rgba(255,255,255,0.5)', letterSpacing: -0.1 }}>
              이제 둘만의 공간이 생겼어요
            </Text>
          </View>
        </Animated.View>

      </View>

      {/* 하단 버튼 */}
      <Animated.View style={[{ paddingHorizontal: 25, paddingBottom: 20 }, btnAnimStyle]}>
        <TouchableOpacity
          style={{
            height: 48, borderRadius: 40,
            backgroundColor: '#F17088',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.08, shadowRadius: 20,
          }}
          onPress={() => router.replace('/(tabs)/home')}
          activeOpacity={0.85}
        >
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 16,
            color: '#fff', letterSpacing: -0.1 }}>
            좋아요!
          </Text>
        </TouchableOpacity>
      </Animated.View>

    </SafeAreaView>
  );
}
