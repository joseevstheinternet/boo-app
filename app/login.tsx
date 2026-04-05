import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../firebaseConfig';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  return Array.from({ length: 6 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join('');
}

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleBack() {
    try {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      if (uid) {
        // 새 코드 생성
        let code = '';
        let exists = true;
        while (exists) {
          code = generateCode();
          const snap = await getDoc(doc(db, 'invite_codes', code));
          exists = snap.exists();
        }
        // 새 코드 저장
        await setDoc(doc(db, 'invite_codes', code), { uid, createdAt: new Date() });
        await setDoc(doc(db, 'users', uid), { myCode: code }, { merge: true });
        await AsyncStorage.setItem('myInviteCode', code);
      }
    } catch (e) {
      console.error('handleBack error:', e);
    } finally {
      router.replace('/connect');
    }
  }

  async function handleLogin() {
    if (!email.trim() || password.length < 6) {
      Alert.alert('이메일과 비밀번호(6자 이상)를 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;
      await AsyncStorage.setItem('userUid', uid);

      const userSnap = await getDoc(doc(db, 'users', uid));
      if (userSnap.exists()) {
        const d = userSnap.data();
        if (d.coupleId) {
          await AsyncStorage.setItem('coupleId', d.coupleId);
          await AsyncStorage.setItem('setupComplete', 'true');
          router.replace('/(tabs)/home');
          return;
        }
      }
      router.replace('/connect');
    } catch (e: any) {
      const msg =
        e.code === 'auth/user-not-found'    ? '등록되지 않은 이메일이에요.' :
        e.code === 'auth/wrong-password'     ? '비밀번호가 틀렸어요.' :
        e.code === 'auth/invalid-email'      ? '올바른 이메일 형식이 아니에요.' :
        e.code === 'auth/invalid-credential' ? '이메일 또는 비밀번호가 올바르지 않아요.' :
        '로그인에 실패했어요.';
      Alert.alert(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={handleBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#2D1B1E" />
        </TouchableOpacity>
      </View>
      <KeyboardAvoidingView
        style={s.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={s.content}>
          <Text style={s.title}>로그인</Text>
          <Text style={s.subtitle}>등록한 이메일로 로그인해요</Text>

          <TextInput
            style={s.input}
            placeholder="이메일"
            placeholderTextColor="#C8B4B8"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={[s.input, { marginTop: 12 }]}
            placeholder="비밀번호"
            placeholderTextColor="#C8B4B8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />
        </View>

        <View style={s.footer}>
          <TouchableOpacity
            style={[s.btn, (!email.trim() || password.length < 6) && s.btnOff]}
            onPress={handleLogin}
            disabled={!email.trim() || password.length < 6 || loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnTxt}>로그인</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  kav:    { flex: 1 },
  header: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 40,
  },
  title: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 24,
    color: '#2D1B1E',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#C4A0A8',
    marginBottom: 40,
  },
  input: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F5ECEE',
    paddingHorizontal: 22,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
  },
  footer: { paddingHorizontal: 24, paddingBottom: 24 },
  btn: {
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOff: { backgroundColor: '#DDACB5' },
  btnTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#fff',
  },
});
