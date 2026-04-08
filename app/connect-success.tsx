import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, Image, Text,
  TouchableOpacity, View,
} from 'react-native';
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

const PARTICLES: ParticleData[] = Array.from({ length: 24 }, (_, i) => {
  const baseAngle = (i / 24) * 2 * Math.PI;
  const jitter    = (Math.random() - 0.5) * (Math.PI / 10);
  const angle     = baseAngle + jitter;
  const distance  = 110 + Math.random() * 90;
  return {
    tx:       Math.cos(angle) * distance,
    ty:       Math.sin(angle) * distance,
    duration: 800 + Math.random() * 400,
    delay:    Math.random() * 120,
    size:     10 + Math.random() * 10,
    icon:     ICONS[i % ICONS.length],
    color:    COLORS[i % COLORS.length],
  };
});

const BURST_LEFT = SW / 2;
const BURST_TOP  = SH * 0.42;

// ─── Particle ────────────────────────────────────────────────────────────────

function Particle({ tx, ty: tyTarget, duration, delay, size, icon, color }: ParticleData) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale      = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const easeOut = Easing.out(Easing.cubic);

    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: duration * 0.15, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: duration * 0.85, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.timing(translateX, { toValue: tx,       duration, easing: easeOut, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: tyTarget, duration, easing: easeOut, useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.3,      duration, easing: easeOut, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: BURST_LEFT - size / 2,
          top:  BURST_TOP  - size / 2,
        },
        {
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
        },
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

  const profileOpacity = useRef(new Animated.Value(0)).current;
  const profileY       = useRef(new Animated.Value(20)).current;
  const heartScale     = useRef(new Animated.Value(0)).current;
  const textOpacity    = useRef(new Animated.Value(0)).current;
  const textY          = useRef(new Animated.Value(16)).current;
  const btnOpacity     = useRef(new Animated.Value(0)).current;
  const btnY           = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    loadData();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(profileOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(profileY,       { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start();
    }, 200);

    setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.sequence([
        Animated.spring(heartScale, { toValue: 1.2, tension: 200, friction: 10, useNativeDriver: true }),
        Animated.spring(heartScale, { toValue: 1,   tension: 200, friction: 15, useNativeDriver: true }),
      ]).start();
    }, 400);

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(textY,       { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start();
    }, 700);

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(btnOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(btnY,       { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start();
    }, 900);
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

      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        pointerEvents="none"
      >
        {PARTICLES.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 40 }}>

        <Animated.View style={{ opacity: profileOpacity, transform: [{ translateY: profileY }] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>

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

            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Ionicons name="heart" size={32} color="#F17088" />
            </Animated.View>

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

        <Animated.View style={[{ alignItems: 'center', gap: 12 }, { opacity: textOpacity, transform: [{ translateY: textY }] }]}>
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

      <Animated.View style={[{ paddingHorizontal: 25, paddingBottom: 20 }, { opacity: btnOpacity, transform: [{ translateY: btnY }] }]}>
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
