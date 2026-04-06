// 필요 시 설치:
//   npx expo install expo-image-picker expo-file-system
//   npx expo install @react-native-async-storage/async-storage
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../firebaseConfig';

// ─── 닉네임 입력 상태 ────────────────────────────────────────────────────────

type InputState = 'default' | 'typing' | 'success';

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SetupScreen() {
  const { coupleId: coupleIdParam } = useLocalSearchParams<{ coupleId: string }>();

  const [nickname, setNickname] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [localUri, setLocalUri] = useState<string | null>(null);   // 갤러리 선택 미리보기
  const [remoteUri, setRemoteUri] = useState<string | null>(null); // Storage 업로드 URL
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<TextInput>(null);

  // ── 입력 상태 계산 ──

  function getInputState(): InputState {
    if (isFocused) return 'typing';
    if (nickname.trim().length > 0) return 'success';
    return 'default';
  }

  const inputState = getInputState();
  const canStart = nickname.trim().length > 0 && !saving && !uploadingImage;

  // ── 이미지 선택 & 업로드 ──

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '갤러리 접근 권한이 필요해요.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    setLocalUri(uri);  // 먼저 로컬 이미지로 미리보기
    await uploadImage(uri);
  }

  async function uploadImage(uri: string) {
    setUploadingImage(true);
    try {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      if (!uid) return;

      const response = await fetch(uri);
      const blob = await response.blob();

      const storage = getStorage(auth.app);

      // 기존 프로필 사진 삭제
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (userSnap.exists()) {
        const oldUrl: string = userSnap.data().profileImage ?? '';
        if (oldUrl) {
          try {
            const oldPath = decodeURIComponent(oldUrl.split('/o/')[1].split('?')[0]);
            await deleteObject(storageRef(storage, oldPath));
          } catch {}
        }
      }

      const sRef = storageRef(storage, `profile-images/${uid}.jpg`);
      await uploadBytes(sRef, blob);
      const downloadURL = await getDownloadURL(sRef);
      setRemoteUri(downloadURL);
    } catch (e) {
      Alert.alert('업로드 실패', '이미지 업로드에 실패했어요. 다시 시도해주세요.');
      setLocalUri(null);
    } finally {
      setUploadingImage(false);
    }
  }

  // ── 저장 & 이동 ──

  async function handleStart() {
    if (!canStart) return;
    setSaving(true);
    try {
      const uid =
        auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      if (!uid) throw new Error('uid not found');

      // 프로필 저장
      await setDoc(
        doc(db, 'users', uid),
        {
          nickname: nickname.trim(),
          profileImage: remoteUri ?? '',
          updatedAt: new Date(),
        },
        { merge: true },
      );

      // couples doc에 내 ready 플래그 설정
      const cid =
        coupleIdParam || (await AsyncStorage.getItem('coupleId')) || '';
      if (cid) {
        const role =
          (await AsyncStorage.getItem('coupleRole')) ?? 'user1';
        const readyField =
          role === 'user1' ? { user1Ready: true } : { user2Ready: true };
        await setDoc(doc(db, 'couples', cid), readyField, { merge: true });
      }

      await AsyncStorage.setItem('setupComplete', 'true');
      router.replace('/connect-loading');
    } catch (e) {
      Alert.alert('저장 실패', '저장에 실패했어요. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  }

  // ── 엔터 키 처리 ──

  function handleSubmitEditing() {
    if (canStart) {
      handleStart();
    } else {
      Keyboard.dismiss();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  const profileSource = localUri
    ? { uri: localUri }
    : require('../assets/images/profile-default.png');

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* ── 상단 콘텐츠: 쓸어내리면 키보드 숨김 ── */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>프로필을 만들어요</Text>
          <Text style={styles.subtitle}>연인에게 보여질 내 정보에요</Text>

          {/* 프로필 이미지 + 힌트 텍스트 — 전체 탭 가능 */}
          <TouchableOpacity
            onPress={handlePickImage}
            activeOpacity={0.8}
            disabled={uploadingImage}
            style={styles.profileTouchable}
          >
            <View style={styles.profileWrap}>
              <View style={styles.profileOuter}>
                {uploadingImage ? (
                  <ActivityIndicator color="#F17088" size="large" />
                ) : (
                  <ExpoImage source={profileSource} style={styles.profileImg} contentFit="cover" cachePolicy="memory-disk" />
                )}
              </View>

              {/* 편집 배지 */}
              <View style={styles.editBadge}>
                <Ionicons name="pencil" size={12} color="#FFFFFF" />
              </View>
            </View>

            <Text style={styles.photoHint}>프로필 사진 추가</Text>
          </TouchableOpacity>

          {/* 닉네임 입력창 */}
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              styles[`input_${inputState}` as keyof typeof styles],
            ]}
            placeholder="닉네임"
            placeholderTextColor="#C8B4B8"
            value={nickname}
            onChangeText={setNickname}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            returnKeyType="done"
            onSubmitEditing={handleSubmitEditing}
            maxLength={20}
          />
        </ScrollView>

        {/* ── 하단 버튼 ── */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.startBtn,
              canStart ? styles.startBtn_active : styles.startBtn_inactive,
            ]}
            onPress={handleStart}
            disabled={!canStart}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.startBtnText}>시작하기</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  kav: {
    flex: 1,
  },

  // ── 상단 콘텐츠
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 32,
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

  // ── 프로필 이미지
  profileTouchable: {
    alignItems: 'center',
    marginBottom: 32,
  },
  profileWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  profileOuter: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#FAD0D8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F17088',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 5,
    overflow: 'hidden',
  },
  profileImg: {
    width: 130,
    height: 130,
    borderRadius: 65,
  },
  editBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  photoHint: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#C4A0A8',
  },

  // ── 닉네임 입력창
  input: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 22,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
  },
  input_default: {
    backgroundColor: '#F5ECEE',
  },
  input_typing: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#F17088',
  },
  input_success: {
    backgroundColor: '#F5ECEE',
  },

  // ── 하단 버튼
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  startBtn: {
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn_active: {
    backgroundColor: '#F17088',
  },
  startBtn_inactive: {
    backgroundColor: '#DDACB5',
  },
  startBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
});
