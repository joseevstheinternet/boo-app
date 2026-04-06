// 필요 시 설치:
//   npx expo install expo-clipboard
//   npx expo install @react-native-async-storage/async-storage
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../firebaseConfig';

// ─── 유틸 ────────────────────────────────────────────────────────────────────

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  return Array.from({ length: 6 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join('');
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ message, visible }: { message: string; visible: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [visible, message]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.toast, { opacity }]}>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

// ─── CodeBox ─────────────────────────────────────────────────────────────────

type BoxState = 'default' | 'typing' | 'success';

function CodeBox({ char, state }: { char: string; state: BoxState }) {
  return (
    <View style={[styles.codeBox, styles[`codeBox_${state}` as keyof typeof styles]]}>
      <Text style={[styles.codeBoxText, state === 'success' && styles.codeBoxText_success]}>
        {char}
      </Text>
    </View>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function ConnectScreen() {
  const [myCode, setMyCode] = useState('');
  const [loadingCode, setLoadingCode] = useState(true);
  const [inputCode, setInputCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState({ message: '', visible: false, key: 0 });

  const inputRef = useRef<TextInput>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingClear = useRef(false);
  const navigatingRef = useRef(false);

  const showToast = (message: string) => {
    setToast(prev => ({ message, visible: true, key: prev.key + 1 }));
  };

  useEffect(() => {
    initUser();
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // ── User2 폴링: 상대방이 내 코드로 연결했는지 감지 ──

  useEffect(() => {
    if (loadingCode) return;

    const interval = setInterval(async () => {
      if (navigatingRef.current) return;

      // 이미 로그인·셋업 완료된 경우 폴링 중지
      const setupDone =
        (await AsyncStorage.getItem('setupComplete')) ??
        (await AsyncStorage.getItem('profileComplete'));
      if (setupDone) { clearInterval(interval); return; }

      try {
        const uid =
          auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
        if (!uid) return;

        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists() && snap.data().coupleId) {
          clearInterval(interval);
          if (navigatingRef.current) return;
          navigatingRef.current = true;

          const cid: string = snap.data().coupleId;
          await AsyncStorage.setItem('coupleId', cid);
          await AsyncStorage.setItem('coupleRole', 'user2');
          router.replace({ pathname: '/setup', params: { coupleId: cid } } as never);
        }
      } catch (e) {
        // poll error silently ignored
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [loadingCode]);

  // ── Firebase 초기화 & 내 코드 로딩 ──

  async function initUser() {
    try {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';

      if (!uid) {
        setLoadingCode(false);
        return;
      }

      // Firebase에서 확인 (AsyncStorage 캐시 무시)
      const userSnap = await getDoc(doc(db, 'users', uid));

      if (userSnap.exists() && userSnap.data().myCode) {
        const code = userSnap.data().myCode;
        await AsyncStorage.setItem('myInviteCode', code);
        setMyCode(code);
      } else {
        const code = await createUniqueCode(uid);
        setMyCode(code);
      }
    } catch (e) {
      // initUser error silently ignored
    } finally {
      setLoadingCode(false);
    }
  }

  async function createUniqueCode(uid: string): Promise<string> {
    let code = '';
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 10) {
      code = generateCode();
      const snap = await getDoc(doc(db, 'invite_codes', code));
      exists = snap.exists();
      attempts++;
    }

    if (attempts >= 10) {
      throw new Error('코드 생성 실패');
    }

    try {
      await setDoc(doc(db, 'invite_codes', code), { uid, createdAt: new Date() });

      await setDoc(doc(db, 'users', uid), { myCode: code }, { merge: true });

      await AsyncStorage.setItem('myInviteCode', code);

      return code;
    } catch (e) {
      throw e;
    }
  }

  // ── 코드 복사 ──

  async function handleCopy() {
    if (!myCode) return;
    await Clipboard.setStringAsync(myCode);
    showToast('복사했어요! 연인에게 코드를 공유해요');
  }

  // ── 백스페이스 길게 누르기 감지 ──

  function handleKeyPress(e: { nativeEvent: { key: string } }) {
    if (e.nativeEvent.key === 'Backspace') {
      // 500ms 타이머 시작 (중복 방지)
      if (!longPressTimer.current && !pendingClear.current) {
        longPressTimer.current = setTimeout(() => {
          pendingClear.current = true;
          longPressTimer.current = null;
        }, 500);
      }
    } else {
      // 다른 키 입력 시 장기 누르기 취소
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      pendingClear.current = false;
    }
  }

  // ── 입력 처리 ──

  function handleInputChange(text: string) {
    const clean = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);

    // 백스페이스 길게 누르기 → 전체 초기화
    if (pendingClear.current) {
      pendingClear.current = false;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      setInputCode('');
      inputRef.current?.clear(); // 네이티브 버퍼도 초기화
      showToast('입력 내용이 지워졌어요');
      return;
    }

    setInputCode(clean);
    if (clean.length === 6) Keyboard.dismiss();
  }

  // ── 연결하기 ──

  async function handleConnect() {
    if (inputCode.length !== 6 || connecting) return;
    setConnecting(true);
    try {
      let uid = auth.currentUser?.uid;

      // Firebase 로그인 상태가 없으면 AsyncStorage에서 복원
      if (!uid) {
        uid = await AsyncStorage.getItem('userUid');
      }

      if (!uid) {
        showToast('로그인 정보를 찾을 수 없어요. 앱을 다시 시작해 주세요.');
        setConnecting(false);
        return;
      }
      const codeSnap = await getDoc(doc(db, 'invite_codes', inputCode));

      if (!codeSnap.exists()) {
        showToast('올바르지 않은 코드예요');
        return;
      }

      const partnerUid: string = codeSnap.data().uid;
      if (partnerUid === uid) {
        showToast('내 코드는 입력할 수 없어요');
        setInputCode('');
        inputRef.current?.clear();
        return;
      }

      // 커플 연결 (status: pending, user1=코드 입력자, user2=코드 공유자)
      const coupleId = [uid, partnerUid].sort().join('_');
      await setDoc(doc(db, 'couples', coupleId), {
        status: 'pending',
        user1: uid,
        user2: partnerUid,
        users: [uid, partnerUid],
        createdAt: new Date(),
      });
      await setDoc(doc(db, 'users', uid), { coupleId, partnerId: partnerUid }, { merge: true });
      await setDoc(doc(db, 'users', partnerUid), { coupleId, partnerId: uid }, { merge: true });

      // 사용한 코드 폐기
      await deleteDoc(doc(db, 'invite_codes', inputCode));

      // 로컬 저장
      await AsyncStorage.setItem('coupleId', coupleId);
      await AsyncStorage.setItem('coupleRole', 'user1');

      navigatingRef.current = true;
      router.replace({ pathname: '/setup', params: { coupleId } } as never);
    } catch (e: any) {
      const msg = e.code === 'permission-denied'
        ? '권한이 없어요'
        : e.message
        ? `${e.message}`
        : '연결에 실패했어요! 다시 시도해주세요';
      showToast(msg);
    } finally {
      setConnecting(false);
    }
  }

  // ── 박스 상태 계산 ──

  function getBoxState(index: number): BoxState {
    if (index < inputCode.length) return 'success';
    if (index === inputCode.length && inputCode.length < 6) return 'typing';
    return 'default';
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.inner}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>연인과 연결하기</Text>
        <Text style={styles.subtitle}>코드를 공유하거나{'\n'}상대방의 코드를 입력해요</Text>
      </View>

      {/* 내 코드 카드 */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>내 코드</Text>
        {loadingCode ? (
          <ActivityIndicator color="#F17088" style={{ marginVertical: 12 }} />
        ) : (
          <Text style={styles.myCode}>{myCode}</Text>
        )}
        <TouchableOpacity style={styles.copyBtn} onPress={handleCopy} activeOpacity={0.7}>
          <Text style={styles.copyBtnText}>코드 복사</Text>
        </TouchableOpacity>
      </View>

      {/* 구분선 */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>또는</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* 상대방 코드 입력 카드 */}
      <View style={styles.card}>
        <Text style={[styles.cardLabel, { alignSelf: 'flex-start' }]}>상대방 코드 입력</Text>

        {/* 6칸 박스 */}
        <TouchableOpacity
          activeOpacity={1}
          style={styles.boxRow}
          onPress={() => inputRef.current?.focus()}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <CodeBox
              key={i}
              char={inputCode[i] ?? ''}
              state={getBoxState(i)}
            />
          ))}
        </TouchableOpacity>

        {/* 숨겨진 TextInput */}
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={inputCode}
          onChangeText={handleInputChange}
          onKeyPress={handleKeyPress}
          maxLength={6}
          autoCapitalize="characters"
          autoCorrect={false}
          keyboardType="default"
        />

        {/* 연결하기 버튼 */}
        <TouchableOpacity
          style={[
            styles.connectBtn,
            inputCode.length === 6 ? styles.connectBtn_active : styles.connectBtn_inactive,
          ]}
          onPress={handleConnect}
          disabled={inputCode.length !== 6 || connecting}
          activeOpacity={0.8}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.connectBtnText}>연결하기</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 로그인 링크 */}
      <TouchableOpacity
        onPress={() => router.push('/login')}
        style={{ marginTop: 16, alignItems: 'center' }}
      >
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#C4A0A8', textDecorationLine: 'underline' }}>
          이미 계정이 있어요
        </Text>
      </TouchableOpacity>

      {/* Toast */}
      <Toast key={toast.key} message={toast.message} visible={toast.visible} />

      </View>
    </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,              // SafeAreaView 안쪽 View에 패딩 적용
  },

  // 헤더
  header: {
    paddingTop: 48,                      // 2. 상단 여백 확보
    paddingBottom: 36,
    gap: 4,
  },
  logo: {
    width: 120,
    height: 40,
    marginLeft: -30
  },
  title: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 26,
    color: '#2D1B1E',
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: 'NotoSansKR-Regular',
    fontSize: 13,
    color: '#9B8B8E',
    lineHeight: 20,
    marginTop: 4,
  },

  // 카드                                 // 4. 카드 배경 — 피그마 기준 연한 핑크
  card: {
    backgroundColor: '#fff6f6',
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 16,
  },
  cardLabel: {
    fontFamily: 'NotoSansKR-Regular',
    fontSize: 12,
    color: '#A08890',
  },

  // 내 코드
  myCode: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 38,
    color: '#2D1B1E',
    letterSpacing: 5,
  },

  // 복사 버튼
  copyBtn: {
    borderWidth: 1,
    borderColor: '#D4A4AE',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  copyBtnText: {
    fontFamily: 'NotoSansKR-Regular',
    fontSize: 13,
    color: '#8C5F68',
  },

  // 구분선
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#EDD5DA',
  },
  dividerText: {
    fontFamily: 'NotoSansKR-Regular',
    fontSize: 12,
    color: '#C4A0A8',
  },

  // 코드 박스 행                          // 5. 박스 크기·간격 피그마 기준 조정
  boxRow: {
    flexDirection: 'row',
    gap: 7,
  },

  // 개별 코드 박스
  codeBox: {
    width: 44,
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBox_default: {
    backgroundColor: '#EDD8DD',
  },
  codeBox_typing: {
    backgroundColor: '#F2B5BE',
  },
  codeBox_success: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D4A4AE',
  },
  codeBoxText: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 20,
    color: 'transparent',               // 빈 칸 숨김
  },
  codeBoxText_success: {
    color: '#2D1B1E',
  },

  // 숨겨진 입력창
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },

  // 연결하기 버튼
  connectBtn: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtn_active: {
    backgroundColor: '#F17088',
  },
  connectBtn_inactive: {
    backgroundColor: '#DDACB5',
  },
  connectBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(45, 27, 30, 0.85)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    maxWidth: '80%',
  },
  toastText: {
    fontFamily: 'NotoSansKR-Regular',
    fontSize: 13,
    color: '#FFFFFF',
    textAlign: 'center',
  },

});
