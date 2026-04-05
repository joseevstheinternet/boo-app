import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  EmailAuthProvider,
  linkWithCredential,
  sendEmailVerification,
  signOut
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref as sRef, uploadBytes } from 'firebase/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../../contexts/ProfileContext';
import { auth, db } from '../../firebaseConfig';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const TEMP_PW = 'Buny_tmp_2025!';

function parseStoragePath(url: string): string | null {
  try {
    const parts = url.split('/o/');
    if (parts.length < 2) return null;
    return decodeURIComponent(parts[1].split('?')[0]);
  } catch {
    return null;
  }
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, visible }: { message: string; visible: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [visible, message]);

  if (!visible) return null;

  return (
    <Animated.View style={[ts.toast, { opacity }]}>
      <Text style={ts.toastText}>{message}</Text>
    </Animated.View>
  );
}

const ts = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(45, 27, 30, 0.85)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    maxWidth: '80%',
    zIndex: 9999,
  },
  toastText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#fff',
    textAlign: 'center',
  },
});

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const { nickname, profileImage } = useProfile();
  const [hasEmail, setHasEmail]         = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [coupleId, setCoupleId]         = useState('');
  const [myUid, setMyUid]               = useState('');
  const [partnerUid, setPartnerUid]     = useState('');
  const [partnerNickname, setPartnerNickname] = useState('');

  // 연결 끊기 상태
  const [disconnectRequestedBy, setDisconnectRequestedBy] = useState('');
  const [disconnectScheduledAt, setDisconnectScheduledAt] = useState<Date | null>(null);

  // 편집 모달
  const [editVisible, setEditVisible]     = useState(false);
  const [editNickname, setEditNickname]   = useState('');
  const [editLocalUri, setEditLocalUri]   = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const editDimAnim   = useRef(new Animated.Value(0)).current;
  const editSheetAnim = useRef(new Animated.Value(300)).current;
  const editPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 0.5) closeEditModal(); },
  })).current;

  // 계정 등록 모달 (커스텀 애니메이션)
  const [emailVisible, setEmailVisible]   = useState(false);
  const [emailStep, setEmailStep]         = useState<1 | 2 | 3>(1);
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [linkingAccount, setLinkingAccount] = useState(false);
  const [verifying, setVerifying]         = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const emailBgOpacity = useRef(new Animated.Value(0)).current;
  const emailSheetY    = useRef(new Animated.Value(300)).current;
  const emailPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 0.5) closeEmailModal(); },
  })).current;

  const [accountManageVisible, setAccountManageVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [accountManageStep, setAccountManageStep] = useState<'menu' | 'password' | 'email'>('menu');
  const [updatingAccount, setUpdatingAccount] = useState(false);
  const accountManageBgOpacity = useRef(new Animated.Value(0)).current;
  const accountManageSheetY    = useRef(new Animated.Value(300)).current;
  const accountManagePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 0.5) closeAccountManageModal(); },
  })).current;

  // 데이터 작업
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast]         = useState({ message: '', visible: false, key: 0 });

  function showToast(message: string) {
    setToast(prev => ({ message, visible: true, key: prev.key + 1 }));
  }

  // ── 데이터 로드 ────────────────────────────────────────────────────────────

  useEffect(() => { load(); }, []);

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem('openProfileEdit').then(val => {
      if (val === '1') {
        AsyncStorage.removeItem('openProfileEdit');
        openEditModal();
      }
    });
  }, []));

  async function load() {
    try {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      if (!uid) return;
      setMyUid(uid);

      const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
      setCoupleId(cid);

      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        const d = snap.data();

        if (d.partnerId) {
          setPartnerUid(d.partnerId);
          const partnerSnap = await getDoc(doc(db, 'users', d.partnerId));
          if (partnerSnap.exists()) {
            setPartnerNickname(partnerSnap.data().nickname ?? '');
          }
        }
      }

      const providers = auth.currentUser?.providerData ?? [];
      const isEmailLinked = providers.some(p => p.providerId === 'password');
      setHasEmail(isEmailLinked && (auth.currentUser?.emailVerified ?? false));

      // 커플 데이터 + 자동 연결 해제 체크
      if (cid) {
        const coupleSnap = await getDoc(doc(db, 'couples', cid));
        if (coupleSnap.exists()) {
          const cd = coupleSnap.data();

          if (cd.disconnectScheduledAt) {
            const scheduledAt: Date = cd.disconnectScheduledAt.toDate();
            if (scheduledAt <= new Date()) {
              // 유예 기간 만료 → 전체 데이터 삭제 후 연결 화면으로
              await deleteAllCoupleData(uid, cid);
              router.replace('/connect');
              return;
            }
            setDisconnectScheduledAt(scheduledAt);
          }

          if (cd.disconnectRequestedBy) {
            setDisconnectRequestedBy(cd.disconnectRequestedBy);
          }
        }
      }
    } catch (e) {
      console.error('more load error:', e);
    } finally {
      setLoading(false);
    }
  }

  // ── 프로필 편집 ────────────────────────────────────────────────────────────

  function openEditModal() {
    setEditNickname(nickname);
    setEditLocalUri(profileImage);
    editDimAnim.setValue(0);
    editSheetAnim.setValue(300);
    setEditVisible(true);
    Animated.parallel([
      Animated.timing(editDimAnim,   { toValue: 0.4, duration: 250, useNativeDriver: true }),
      Animated.spring(editSheetAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }),
    ]).start();
  }

  function closeEditModal() {
    Animated.parallel([
      Animated.timing(editDimAnim,   { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(editSheetAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => setEditVisible(false));
  }

  async function handlePickProfileImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('갤러리 접근 권한이 필요해요.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setEditLocalUri(result.assets[0].uri);
    }
  }

  async function handleSaveProfile() {
    if (!editNickname.trim()) return;
    setSavingProfile(true);
    try {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      let remoteUri = profileImage;

      if (editLocalUri && editLocalUri !== profileImage) {
        const blob = await fetch(editLocalUri).then(r => r.blob());
        const storage = getStorage(auth.app);

        // 기존 프로필 사진 삭제
        if (profileImage) {
          const oldPath = parseStoragePath(profileImage);
          if (oldPath) {
            try {
              await deleteObject(sRef(storage, oldPath));
            } catch {}
          }
        }

        const ref = sRef(storage, `profiles/${uid}.jpg`);
        await uploadBytes(ref, blob);
        remoteUri = await getDownloadURL(ref);
      }

      const newNickname = editNickname.trim();
      await setDoc(doc(db, 'users', uid), {
        nickname: newNickname,
        profileImage: remoteUri,
        updatedAt: new Date(),
      }, { merge: true });

      // 과거 게시글 / 댓글 닉네임·프로필 일괄 업데이트
      const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
      if (cid) {
        const profileUpdate = { authorNickname: newNickname, authorProfileImage: remoteUri };

        const [postsSnap, flatCommentsSnap] = await Promise.all([
          getDocs(query(collection(db, 'couples', cid, 'posts'), where('authorId', '==', uid))),
          getDocs(query(collection(db, 'couples', cid, 'comments'), where('authorId', '==', uid))),
        ]);

        const subCommentsSnap = cid
          ? await getDocs(query(collection(db, 'couples', cid, 'comments'), where('authorId', '==', uid)))
          : { docs: [] as any[] };

        await Promise.all([
          ...postsSnap.docs.map(d => updateDoc(d.ref, profileUpdate)),
          ...flatCommentsSnap.docs.map(d => updateDoc(d.ref, profileUpdate)),
          ...subCommentsSnap.docs.map(d => updateDoc(d.ref, profileUpdate)),
        ]);
      }

      closeEditModal();
    } catch {
      Alert.alert('저장에 실패했어요.');
    } finally {
      setSavingProfile(false);
    }
  }

  // ── 계정 등록 (애니메이션 모달) ─────────────────────────────────────────────

  function openAccountManageModal() {
    accountManageBgOpacity.setValue(0);
    accountManageSheetY.setValue(300);
    setAccountManageStep('menu');
    setCurrentPassword('');
    setNewPassword('');
    setNewEmail('');
    setAccountManageVisible(true);
    Animated.parallel([
      Animated.timing(accountManageBgOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(accountManageSheetY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function closeAccountManageModal() {
    // step이 password나 email이면 입력 중 → 확인 알림
    if ((accountManageStep === 'password' && (currentPassword || newPassword)) ||
        (accountManageStep === 'email' && (currentPassword || newEmail))) {
      Alert.alert('변경을 중단하시겠어요?', '입력한 정보가 저장되지 않습니다.', [
        { text: '계속 입력', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: () => {
            Animated.parallel([
              Animated.timing(accountManageBgOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
              Animated.timing(accountManageSheetY, { toValue: 300, duration: 200, useNativeDriver: true }),
            ]).start(() => setAccountManageVisible(false));
          },
        },
      ]);
      return;
    }

    Animated.parallel([
      Animated.timing(accountManageBgOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(accountManageSheetY, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => setAccountManageVisible(false));
  }

  async function handleChangePassword() {
    if (!currentPassword || newPassword.length < 6) return;
    setUpdatingAccount(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) return;
      const { reauthenticateWithCredential, updatePassword } = await import('firebase/auth');
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPassword);
      closeAccountManageModal();
      setCurrentPassword('');
      setNewPassword('');
      showToast('비밀번호가 변경됐어요 ✓');
    } catch (e: any) {
      const msg =
        e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
          ? '현재 비밀번호가 올바르지 않아요.'
          : '변경에 실패했어요. (' + (e.code ?? '') + ')';
      Alert.alert(msg);
    } finally {
      setUpdatingAccount(false);
    }
  }

  async function handleChangeEmail() {
    if (!currentPassword || !newEmail.trim()) return;
    setUpdatingAccount(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) return;
      const { reauthenticateWithCredential, verifyBeforeUpdateEmail } = await import('firebase/auth');
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);
      await verifyBeforeUpdateEmail(user, newEmail.trim());
      closeAccountManageModal();
      Alert.alert('인증 메일을 보냈어요', `${newEmail.trim()}으로 인증 메일을 보냈어요.\n링크를 클릭하면 이메일이 변경돼요.`);
    } catch (e: any) {
      const msg =
        e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
          ? '현재 비밀번호가 올바르지 않아요.' :
        e.code === 'auth/email-already-in-use'
          ? '이미 사용 중인 이메일이에요.' :
        e.code === 'auth/invalid-email'
          ? '올바른 이메일 형식이 아니에요.' :
          '변경에 실패했어요. (' + (e.code ?? '') + ')';
      Alert.alert(msg);
    } finally {
      setUpdatingAccount(false);
    }
  }

  function openEmailModal() {
    emailBgOpacity.setValue(0);
    emailSheetY.setValue(300);
    setEmailStep(1);
    setEmail('');
    setPassword('');

    // 쿨다운 복원
    AsyncStorage.getItem('resendCooldownExpireAt').then(val => {
      if (val) {
        const remaining = Math.ceil((Number(val) - Date.now()) / 1000);
        if (remaining > 0) {
          setResendCooldown(remaining);
          const timer = setInterval(() => {
            setResendCooldown(prev => {
              if (prev <= 1) { clearInterval(timer); return 0; }
              return prev - 1;
            });
          }, 1000);
        }
      }
    });

    setEmailVisible(true);
    Animated.parallel([
      Animated.timing(emailBgOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(emailSheetY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function closeEmailModal() {
    // step 1: 이메일 입력 중 → 확인 알림
    if (emailStep === 1 && email.trim()) {
      Alert.alert('등록을 중단하시겠어요?', '입력한 이메일이 저장되지 않습니다.', [
        { text: '계속 입력', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: () => {
            Animated.parallel([
              Animated.timing(emailBgOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
              Animated.timing(emailSheetY, { toValue: 300, duration: 200, useNativeDriver: true }),
            ]).start(() => setEmailVisible(false));
          },
        },
      ]);
      return;
    }

    // step 2: 인증 메일 발송됨 → 확인 알림
    if (emailStep === 2) {
      Alert.alert('등록을 중단하시겠어요?', '인증 메일을 다시 요청해야 합니다.', [
        { text: '계속 진행', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: () => {
            Animated.parallel([
              Animated.timing(emailBgOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
              Animated.timing(emailSheetY, { toValue: 300, duration: 200, useNativeDriver: true }),
            ]).start(() => setEmailVisible(false));
          },
        },
      ]);
      return;
    }

    Animated.parallel([
      Animated.timing(emailBgOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(emailSheetY, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => setEmailVisible(false));
  }

  async function handleSendVerification() {
    if (!email.trim()) return;
    setLinkingAccount(true);
    try {
      const user = auth.currentUser;
      if (!user) return;

      const prevUid = user.uid; // 익명 uid (기기 uid)

      // 1. 임시 비밀번호로 이메일 연동
      const credential = EmailAuthProvider.credential(email.trim(), TEMP_PW);
      await linkWithCredential(user, credential);

      // 2. 임시 비밀번호로 로그인한 상태 → 이메일 검증 메일 발송
      await sendEmailVerification(user);

      setEmailStep(2);
    } catch (e: any) {
      const msg =
        e.code === 'auth/email-already-in-use' ? '이미 사용 중인 이메일이에요.' :
        e.code === 'auth/invalid-email'         ? '올바른 이메일 형식이 아니에요.' :
        '인증 메일 발송에 실패했어요. (' + (e.code ?? '') + ')';
      Alert.alert(msg);
    } finally {
      setLinkingAccount(false);
    }
  }

  async function handleCheckVerified() {
    setVerifying(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      await user.reload();
      if (user.emailVerified) {
        setEmailStep(3);
      } else {
        Alert.alert('아직 인증이 완료되지 않았어요.', '메일함에서 링크를 클릭한 후 다시 시도해 주세요.');
      }
    } catch {
      Alert.alert('확인에 실패했어요. 다시 시도해 주세요.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleResendVerification() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await sendEmailVerification(user);
      const expireAt = Date.now() + 60 * 1000;
      await AsyncStorage.setItem('resendCooldownExpireAt', String(expireAt));
      setResendCooldown(60);
      const timer = setInterval(() => {
        setResendCooldown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
      showToast('인증 메일을 다시 보냈어요');
    } catch {
      Alert.alert('재전송에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  async function handleSetPassword() {
    if (password.length < 6) {
      Alert.alert('비밀번호는 6자 이상이어야 해요.');
      return;
    }
    setLinkingAccount(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) return;

      const prevUid = user.uid; // 임시 비밀번호로 로그인한 상태의 uid

      // 1. 임시 비밀번호로 재인증
      const { reauthenticateWithCredential, updatePassword } = await import('firebase/auth');
      const tempCredential = EmailAuthProvider.credential(user.email, TEMP_PW);
      await reauthenticateWithCredential(user, tempCredential);

      // 2. 실제 비밀번호로 변경 (이제부터 이 비밀번호로만 로그인 가능)
      await updatePassword(user, password);

      // 3. 기존 uid(prevUid)의 모든 데이터를 현재 uid로 마이그레이션
      const prevSnap = await getDoc(doc(db, 'users', prevUid));
      if (prevSnap.exists()) {
        const prevData = prevSnap.data();

        // 현재 uid에 모든 데이터 복사
        await setDoc(doc(db, 'users', user.uid), {
          ...prevData,
          email: user.email,
          emailVerified: true,
          createdAt: new Date(),
        }, { merge: true });

        // 커플이 있으면 커플 데이터에서 uid 업데이트
        if (prevData.coupleId) {
          const coupleId = prevData.coupleId;
          const coupleSnap = await getDoc(doc(db, 'couples', coupleId));
          if (coupleSnap.exists()) {
            const coupleData = coupleSnap.data();
            const updates: Record<string, any> = {};

            if (coupleData.user1 === prevUid) updates.user1 = user.uid;
            if (coupleData.user2 === prevUid) updates.user2 = user.uid;
            if (coupleData.users?.includes(prevUid)) {
              updates.users = coupleData.users.map((u: string) => u === prevUid ? user.uid : u);
            }

            if (Object.keys(updates).length > 0) {
              await updateDoc(doc(db, 'couples', coupleId), updates);
            }
          }

          // 메시지, 피드 등 모든 서브컬렉션에서 senderId 업데이트
          const collections = ['messages', 'posts', 'album', 'daily', 'anniversaries', 'comments'];
          for (const col of collections) {
            const colSnap = await getDocs(
              query(collection(db, 'couples', coupleId, col), where('senderId', '==', prevUid))
            );
            const batch = writeBatch(db);
            colSnap.docs.forEach(d => batch.update(d.ref, { senderId: user.uid }));
            if (colSnap.docs.length > 0) await batch.commit();
          }
        }
      }

      // 4. AsyncStorage에 새 uid 저장
      await AsyncStorage.setItem('userUid', user.uid);
      setMyUid(user.uid);
      setHasEmail(true);

      closeEmailModal();
      Alert.alert('계정이 등록됐어요 ✓');
    } catch (e: any) {
      const msg =
        e.code === 'auth/wrong-password'  ? '인증 정보가 올바르지 않아요. 처음부터 다시 시도해 주세요.' :
        e.code === 'auth/invalid-email'   ? '올바른 이메일 형식이 아니에요.' :
        '등록에 실패했어요. (' + (e.code ?? '') + ')';
      Alert.alert(msg);
    } finally {
      setLinkingAccount(false);
    }
  }

  // ── 전체 데이터 삭제 ───────────────────────────────────────────────────────

  async function deleteAllCoupleData(uid: string, cid: string) {
    const BATCH_SIZE = 400;

    async function deleteCollection(colRef: ReturnType<typeof collection>) {
      const snap = await getDocs(colRef);
      for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }

    if (cid) {
      // posts 서브컬렉션의 comments 삭제
      const postsSnap = await getDocs(collection(db, 'couples', cid, 'posts'));
      for (const postDoc of postsSnap.docs) {
        await deleteCollection(collection(db, 'couples', cid, 'posts', postDoc.id, 'comments'));
      }

      // 서브컬렉션 삭제
      for (const col of ['messages', 'daily', 'anniversaries', 'album', 'posts']) {
        await deleteCollection(collection(db, 'couples', cid, col));
      }

      // couples 문서 삭제
      await deleteDoc(doc(db, 'couples', cid));
    }

    // Storage 프로필 이미지 삭제
    if (profileImage) {
      const path = parseStoragePath(profileImage);
      if (path) {
        try { await deleteObject(sRef(getStorage(auth.app), path)); } catch {}
      }
    }

    // users 문서 삭제
    await deleteDoc(doc(db, 'users', uid));

    // auth 계정 삭제
    if (auth.currentUser) {
      try {
        await auth.currentUser.delete();
      } catch (e: any) {
        if (e.code === 'auth/requires-recent-login') {
          const providers = auth.currentUser.providerData;
          const isEmail = providers.some(p => p.providerId === 'password');
          if (isEmail) {
            Alert.alert(
              '본인 확인이 필요해요',
              '보안을 위해 비밀번호를 다시 입력해 주세요.',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '확인',
                  onPress: () => {
                    Alert.prompt(
                      '비밀번호 입력',
                      '',
                      async (pw) => {
                        if (!pw) return;
                        try {
                          const email = auth.currentUser?.email ?? '';
                          const { EmailAuthProvider, reauthenticateWithCredential } = await import('firebase/auth');
                          const cred = EmailAuthProvider.credential(email, pw);
                          await reauthenticateWithCredential(auth.currentUser!, cred);
                          await auth.currentUser!.delete();
                        } catch {
                          Alert.alert('재인증에 실패했어요. 다시 시도해 주세요.');
                        }
                      },
                      'secure-text',
                    );
                  },
                },
              ],
            );
            return;
          }
        }
        console.error('account delete error:', e);
      }
    }

    // AsyncStorage 초기화 (userUid 제외)
    await AsyncStorage.multiRemove(['coupleId', 'coupleRole', 'setupComplete', 'profileComplete']);
  }

  // ── 연결 끊기 ─────────────────────────────────────────────────────────────

  function handleDisconnectRequest() {
    const message = hasEmail
      ? '14일 후 모든 대화, 앨범, 게시물 데이터와\n연동된 이메일 계정이 삭제돼요.\n되돌릴 수 없어요.'
      : '14일 후 모든 대화, 앨범, 게시물 데이터가\n영구 삭제돼요. 되돌릴 수 없어요.';

    Alert.alert('연결 끊기 및 데이터 삭제', message, [
      { text: '취소', style: 'cancel' },
      {
        text: '끊기 요청', style: 'destructive',
        onPress: async () => {
          try {
            const now = new Date();
            const scheduled = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
            await setDoc(doc(db, 'couples', coupleId), {
              disconnectRequestedBy: myUid,
              disconnectRequestedAt: Timestamp.fromDate(now),
              disconnectScheduledAt: Timestamp.fromDate(scheduled),
            }, { merge: true });
            setDisconnectRequestedBy(myUid);
            setDisconnectScheduledAt(scheduled);
          } catch {
            Alert.alert('요청에 실패했어요.');
          }
        },
      },
    ]);
  }

  async function handleCancelDisconnect() {
    try {
      await setDoc(doc(db, 'couples', coupleId), {
        disconnectRequestedBy: deleteField(),
        disconnectRequestedAt: deleteField(),
        disconnectScheduledAt: deleteField(),
      }, { merge: true });
      setDisconnectRequestedBy('');
      setDisconnectScheduledAt(null);
    } catch {
      Alert.alert('취소에 실패했어요.');
    }
  }

  function getDaysLeft(): number {
    if (!disconnectScheduledAt) return 14;
    const now = new Date();
    return Math.max(0, Math.ceil((disconnectScheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  // ── 백업 ──────────────────────────────────────────────────────────────────

  async function handleExportChat() {
    if (!coupleId) { Alert.alert('연결된 커플이 없어요.'); return; }

    Alert.alert('대화 내역 백업', '대화 내역을 텍스트 파일로 내보낼까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '내보내기',
        onPress: async () => {
          setExporting(true);
          try {
            const messagesRef = collection(db, 'couples', coupleId, 'messages');
            const q = query(messagesRef, orderBy('createdAt', 'asc'));
            const snap = await getDocs(q);

            const nicknameMap: Record<string, string> = {
              [myUid]: nickname || '나',
              [partnerUid]: partnerNickname || '상대방',
            };

            const lines = snap.docs.map(d => {
              const data = d.data();
              const ts: Date = data.createdAt?.toDate() ?? new Date(0);
              const year  = ts.getFullYear();
              const month = String(ts.getMonth() + 1).padStart(2, '0');
              const day   = String(ts.getDate()).padStart(2, '0');
              const hour  = String(ts.getHours()).padStart(2, '0');
              const min   = String(ts.getMinutes()).padStart(2, '0');
              const nick  = nicknameMap[data.senderId] ?? data.senderId;
              const text  = data.text ?? '';
              return `[${year}.${month}.${day} ${hour}:${min}] ${nick}: ${text}`;
            });

            const content = lines.join('\n');
            const fileName = `buny-chat-${new Date().toISOString().split('T')[0]}.txt`;
            const filePath = `${FileSystem.cacheDirectory}${fileName}`;
            await FileSystem.writeAsStringAsync(filePath, content, { encoding: 'utf8' });

            const canShare = await Sharing.isAvailableAsync();
            if (!canShare) { Alert.alert('공유 기능을 사용할 수 없어요.'); return; }
            await Sharing.shareAsync(filePath, { mimeType: 'text/plain', dialogTitle: '대화 내역 내보내기' });
          } catch (e) {
            console.error('export error:', e);
            Alert.alert('내보내기에 실패했어요.');
          } finally {
            setExporting(false);
          }
        },
      },
    ]);
  }

  // ── 대화 내역 불러오기 ────────────────────────────────────────────────────

  async function handleImportChat() {
    if (!coupleId) { Alert.alert('연결된 커플이 없어요.'); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/plain', copyToCacheDirectory: true });
      if (result.canceled) return;

      setImporting(true);
      const fileUri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri, { encoding: 'utf8' });
      const lines = content.split('\n').filter(l => l.trim());

      const nicknameToUid: Record<string, string> = {};
      if (nickname)        nicknameToUid[nickname]        = myUid;
      if (partnerNickname) nicknameToUid[partnerNickname] = partnerUid;

      const LINE_RE = /^\[(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2})\] (.+?): (.+)$/;
      const parsed: Array<{ createdAt: Timestamp; senderId: string; text: string; imported: boolean }> = [];

      for (const line of lines) {
        const m = line.match(LINE_RE);
        if (!m) continue;
        const [, datePart, nick, text] = m;
        const [dateSeg, timeSeg] = datePart.split(' ');
        const [year, month, day] = dateSeg.split('.').map(Number);
        const [hour, minute]     = timeSeg.split(':').map(Number);
        const date = new Date(year, month - 1, day, hour, minute);
        const senderId = nicknameToUid[nick] ?? nick;
        parsed.push({ createdAt: Timestamp.fromDate(date), senderId, text, imported: true });
      }

      // Firestore batch write (500개 제한 대비 400개씩 청크)
      const messagesRef = collection(db, 'couples', coupleId, 'messages');
      const CHUNK = 400;
      for (let i = 0; i < parsed.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const msg of parsed.slice(i, i + CHUNK)) {
          batch.set(doc(messagesRef), { ...msg, read: true });
        }
        await batch.commit();
      }

      showToast(`${parsed.length}개의 메시지를 불러왔어요`);
    } catch (e) {
      console.error('import error:', e);
      Alert.alert('불러오기에 실패했어요.');
    } finally {
      setImporting(false);
    }
  }

  // ── 로그아웃 ────────────────────────────────────────────────────────────────

  async function handleSignOut() {
    const title = '';
    const message = hasEmail
      ? '로그아웃 하시겠어요?'
      : '재로그인에 필요한 이메일이 등록되지 않았어요!\n계정 등록 후 로그아웃을 권장드려요.\n정말 로그아웃하시겠어요?';

    const confirmText = hasEmail ? '로그아웃' : '확인';

    Alert.alert(title, message, [
      { text: '취소', style: 'cancel' },
      {
        text: confirmText,
        style: 'destructive',
        onPress: async () => {
          await signOut(auth);
          // 로그아웃 후 기기 uid로 자동 로그인 (또는 /connect로 이동)
          // AsyncStorage의 coupleId만 삭제 (userUid는 유지)
          await AsyncStorage.multiRemove(['coupleId', 'coupleRole', 'setupComplete', 'profileComplete']);
          router.replace('/connect');
        },
      },
    ]);
  }

  // ── 개발 초기화 ─────────────────────────────────────────────────────────────

  async function handleDevReset() {
    Alert.alert('초기화', 'AsyncStorage를 전부 지우고 /connect로 이동해요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화', style: 'destructive',
        onPress: async () => {
          await AsyncStorage.clear();
          router.replace('/connect');
        },
      },
    ]);
  }

  // ── 렌더 ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' }}>
        <ActivityIndicator color="#F17088" />
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <SafeAreaView style={s.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardDismissMode="on-drag">

        {/* ── 프로필 섹션 ─────────────────────────────────────────────────── */}
        <View style={s.profileCard}>
          <ExpoImage
            source={profileImage
              ? { uri: profileImage }
              : require('../../assets/images/profile-default.png')}
            style={s.avatar}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <View style={s.profileInfo}>
            <Text style={s.nicknameText}>{nickname || '닉네임'}</Text>
          </View>
          <TouchableOpacity style={s.editBtn} onPress={openEditModal} hitSlop={{ top: 12, bottom: 12, left: 50, right: 50 }}>
            <Text style={s.editBtnTxt}>편집</Text>
          </TouchableOpacity>
        </View>

        {/* ── 연결 끊기 배너 ───────────────────────────────────────────────── */}
        {disconnectRequestedBy !== '' && (
          <View style={s.disconnectBanner}>
            <Text style={s.disconnectBannerText}>
              {disconnectRequestedBy === myUid
                ? `연결 끊기가 요청됐어요 · D-${getDaysLeft()} 후 해제돼요`
                : `상대방이 연결 끊기를 요청했어요 · D-${getDaysLeft()}`}
            </Text>
            <TouchableOpacity onPress={handleCancelDisconnect} style={s.disconnectCancelBtn}>
              <Text style={s.disconnectCancelTxt}>취소</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 설정 메뉴 ───────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>설정</Text>
          <View style={s.menuCard}>

            <View style={[s.menuRow, s.menuBorder]}>
              <Text style={s.menuLabel}>알림 설정</Text>
              <Switch
                value={notifEnabled}
                onValueChange={setNotifEnabled}
                trackColor={{ false: '#EDD5DA', true: '#F17088' }}
                thumbColor="#fff"
              />
            </View>

            <View style={[s.menuRow, s.menuBorder]}>
              <Text style={[s.menuLabel, s.menuLabelDim]}>테마</Text>
              <Text style={s.badge}>추후 공개</Text>
            </View>

            <TouchableOpacity
              style={[s.menuRow, s.menuBorder]}
              onPress={() => { if (hasEmail) openAccountManageModal(); else openEmailModal(); }}
              activeOpacity={0.7}
              activeOpacity={hasEmail ? 1 : 0.7}
            >
              <Text style={s.menuLabel}>계정 등록</Text>
              {hasEmail
                ? <Text style={s.valueGreen}>연동됨 ✓</Text>
                : <Text style={s.chevron}>›</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.menuRow, s.menuBorder]}
              activeOpacity={0.7}
              onPress={() => router.push('/notice')}
            >
              <Text style={s.menuLabel}>공지사항</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>

            <View style={s.menuRow}>
              <Text style={s.menuLabel}>앱 버전</Text>
              <Text style={s.valueDim}>v{APP_VERSION}</Text>
            </View>

          </View>
        </View>

        {/* ── 데이터 섹션 ─────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>데이터</Text>
          <View style={s.menuCard}>

            <TouchableOpacity
              style={[s.menuRow, s.menuBorder]}
              onPress={handleExportChat}
              disabled={exporting}
              activeOpacity={0.7}
            >
              <Text style={s.menuLabel}>대화 내역 백업</Text>
              {exporting
                ? <ActivityIndicator size="small" color="#F17088" />
                : <Text style={s.chevron}>›</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={s.menuRow}
              onPress={handleImportChat}
              disabled={importing}
              activeOpacity={0.7}
            >
              <Text style={s.menuLabel}>대화 내역 불러오기</Text>
              {importing
                ? <ActivityIndicator size="small" color="#F17088" />
                : <Text style={s.chevron}>›</Text>}
            </TouchableOpacity>

          </View>
        </View>

        {/* ── 연결 끊기 ────────────────────────────────────────────────────── */}
        {coupleId !== '' && disconnectRequestedBy === '' && (
          <View style={s.section}>
            <View style={s.menuCard}>
              <TouchableOpacity
                style={s.menuRow}
                onPress={handleDisconnectRequest}
                activeOpacity={0.7}
              >
                <Text style={[s.menuLabel, { color: '#E05070' }]}>연결 끊기</Text>
                <Text style={[s.chevron, { color: '#E05070' }]}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── 로그아웃 ─────────────────────────────────────────────────────── */}
        <View style={s.section}>
          <TouchableOpacity style={s.logoutBtn} onPress={handleSignOut} activeOpacity={0.7}>
            <Text style={s.logoutTxt}>로그아웃</Text>
          </TouchableOpacity>
        </View>

        {/* ── 개발 모드 ─────────────────────────────────────────────────────── */}
        {__DEV__ && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>개발</Text>
            <TouchableOpacity style={s.devBtn} onPress={handleDevReset} activeOpacity={0.7}>
              <Text style={s.devBtnTxt}>🛠 초기화 (AsyncStorage 전체 삭제)</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[s.devBtn, { marginTop: 8, backgroundColor: '#FFEBEE' }]} 
              onPress={async () => {
                Alert.alert('테스트', `coupleId: ${coupleId}, myUid: ${myUid}`);
                if (!coupleId || !myUid) {
                  Alert.alert('에러', '로드 안 됨');
                  return;
                }
                try {
                  Alert.alert('시작', '데이터 삭제 시작...');
                  await deleteAllCoupleData(myUid, coupleId);
                  Alert.alert('완료', '데이터 삭제 완료');
                  router.replace('/connect');
                } catch (e) {
                  Alert.alert('실패', String(e));
                }
              }} 
              activeOpacity={0.7}
            >
              <Text style={[s.devBtnTxt, { color: '#C62828' }]}>🔥 즉시 연결 끊기 & 데이터 삭제</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      <Toast key={toast.key} message={toast.message} visible={toast.visible} />

      {/* ── 프로필 편집 모달 ──────────────────────────────────────────────────── */}
      <Modal visible={editVisible} transparent animationType="none" onRequestClose={closeEditModal}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: editDimAnim }]}
          pointerEvents="none"
        />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeEditModal} />
          <Animated.View style={{ transform: [{ translateY: editSheetAnim }] }}>
            <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
              <View {...editPan.panHandlers} style={{ alignItems: 'center', paddingBottom: 4 }}>
                <View style={s.handle} />
              </View>
              <Text style={s.modalTitle}>프로필 편집</Text>

              <TouchableOpacity style={s.avatarWrap} onPress={handlePickProfileImage} activeOpacity={0.8}>
                <ExpoImage
                  source={editLocalUri
                    ? { uri: editLocalUri }
                    : require('../../assets/images/profile-default.png')}
                  style={s.avatarPick}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                <View style={s.cameraBadge}>
                  <Ionicons name="camera" size={14} color="#F17088" />
                </View>
              </TouchableOpacity>

              <TextInput
                style={s.input}
                placeholder="닉네임"
                placeholderTextColor="#C8B4B8"
                value={editNickname}
                onChangeText={setEditNickname}
                maxLength={20}
              />

              <TouchableOpacity
                style={[s.saveBtn, !editNickname.trim() && s.saveBtnOff]}
                onPress={handleSaveProfile}
                disabled={!editNickname.trim() || savingProfile}
              >
                {savingProfile
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnTxt}>저장하기</Text>}
              </TouchableOpacity>
              <View style={{ position: 'absolute', bottom: -50, left: 0, right: 0, height: 50, backgroundColor: '#fff' }} pointerEvents="none" />
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 계정 등록 모달 (커스텀 애니메이션) ─────────────────────────────────── */}
      <Modal visible={emailVisible} transparent animationType="none" onRequestClose={closeEmailModal}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: emailBgOpacity }]}
          pointerEvents="none"
        >
          <BlurView intensity={10} style={StyleSheet.absoluteFill} tint="dark" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeEmailModal} />
          <Animated.View style={{ transform: [{ translateY: emailSheetY }] }}>
            <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
              <View {...emailPan.panHandlers} style={{ alignItems: 'center', paddingBottom: 4 }}>
                <View style={s.handle} />
              </View>
              <Text style={s.modalTitle}>계정 등록</Text>

              {emailStep === 1 && (
                <Text style={s.modalDesc}>
                  {'이메일로 계정을 등록하면 기기를 바꿔도 데이터를 유지할 수 있어요.\n등록된 이메일은 나만 볼 수 있어요.'}
                </Text>
              )}

              {/* TextInput always mounted (steps 1-2) to prevent keyboard dismiss on step transition */}
              {(emailStep === 1 || emailStep === 2) && (
                <TextInput
                  style={emailStep === 2 ? { display: 'none' } : s.input}
                  placeholder="이메일"
                  placeholderTextColor="#C8B4B8"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              )}

              {emailStep === 1 && (
                <TouchableOpacity
                  style={[s.saveBtn, !email.trim() && s.saveBtnOff]}
                  onPress={handleSendVerification}
                  disabled={!email.trim() || linkingAccount}
                >
                  {linkingAccount
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.saveBtnTxt}>인증 메일 보내기</Text>}
                </TouchableOpacity>
              )}

              {emailStep === 2 && (
                <>
                  <Text style={s.modalDesc}>
                    {`${email}으로 인증 메일을 보냈어요!\n메일이 오지 않으면 스팸 메일함도 확인해 주세요`}
                  </Text>
                  <TouchableOpacity
                    style={s.saveBtn}
                    onPress={handleCheckVerified}
                    disabled={verifying}
                  >
                    {verifying
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={s.saveBtnTxt}>인증을 완료했어요</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ marginTop: 14, alignItems: 'center' }}
                    onPress={handleResendVerification}
                    disabled={resendCooldown > 0}
                  >
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, color: resendCooldown > 0 ? '#C4A0A8' : '#F17088' }}>
                      {resendCooldown > 0 ? `재전송 (${resendCooldown}초 후 가능)` : '메일 재전송'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {emailStep === 3 && (
                <>
                  <Text style={s.modalDesc}>
                    이메일 인증이 완료됐어요. 사용할 비밀번호를 입력해 주세요.
                  </Text>
                  <TextInput
                    style={s.input}
                    placeholder="비밀번호 (6자 이상)"
                    placeholderTextColor="#C8B4B8"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={[s.saveBtn, password.length < 6 && s.saveBtnOff]}
                    onPress={handleSetPassword}
                    disabled={password.length < 6 || linkingAccount}
                  >
                    {linkingAccount
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={s.saveBtnTxt}>등록하기</Text>}
                  </TouchableOpacity>
                </>
              )}
              <View style={{ position: 'absolute', bottom: -50, left: 0, right: 0, height: 50, backgroundColor: '#fff' }} pointerEvents="none" />
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 계정 관리 모달 ─────────────────────────────────────────────────────── */}
      <Modal visible={accountManageVisible} transparent animationType="none" onRequestClose={closeAccountManageModal}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: accountManageBgOpacity }]}
          pointerEvents="none"
        >
          <BlurView intensity={10} style={StyleSheet.absoluteFill} tint="dark" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAccountManageModal} />
          <Animated.View style={{ transform: [{ translateY: accountManageSheetY }] }}>
            <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
              <View {...accountManagePan.panHandlers} style={{ alignItems: 'center', paddingBottom: 4 }}>
                <View style={s.handle} />
              </View>

              {accountManageStep === 'menu' && (
                <>
                  <Text style={s.modalTitle}>계정 관리</Text>
                  <Text style={[s.modalDesc, { marginBottom: 10 }]}>{auth.currentUser?.email ?? ''}</Text>
                  <TouchableOpacity
                    style={[s.saveBtn, { backgroundColor: '#F5ECEE' }]}
                    onPress={() => { setAccountManageStep('password'); }}
                  >
                    <Text style={[s.saveBtnTxt, { color: '#F17088' }]}>비밀번호 변경</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.saveBtn, { marginTop: 8, backgroundColor: '#F5ECEE' }]}
                    onPress={() => { setAccountManageStep('email'); }}
                  >
                    <Text style={[s.saveBtnTxt, { color: '#F17088' }]}>이메일 변경</Text>
                  </TouchableOpacity>
                </>
              )}

              {accountManageStep === 'password' && (
                <>
                  <TouchableOpacity onPress={() => setAccountManageStep('menu')} style={{ marginBottom: 12 }}>
                    <Ionicons name="chevron-back" size={22} color="#2D1B1E" />
                  </TouchableOpacity>
                  <Text style={s.modalTitle}>비밀번호 변경</Text>
                  <TextInput
                    style={s.input}
                    placeholder="현재 비밀번호"
                    placeholderTextColor="#C8B4B8"
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry
                  />
                  <TextInput
                    style={[s.input, { marginTop: 10 }]}
                    placeholder="새 비밀번호 (6자 이상)"
                    placeholderTextColor="#C8B4B8"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={[s.saveBtn, { marginTop: 24 }, (!currentPassword || newPassword.length < 6) && s.saveBtnOff]}
                    onPress={handleChangePassword}
                    disabled={!currentPassword || newPassword.length < 6 || updatingAccount}
                  >
                    {updatingAccount
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={s.saveBtnTxt}>변경하기</Text>}
                  </TouchableOpacity>
                </>
              )}

              {accountManageStep === 'email' && (
                <>
                  <TouchableOpacity onPress={() => setAccountManageStep('menu')} style={{ marginBottom: 12 }}>
                    <Ionicons name="chevron-back" size={22} color="#2D1B1E" />
                  </TouchableOpacity>
                  <Text style={s.modalTitle}>이메일 변경</Text>
                  <TextInput
                    style={s.input}
                    placeholder="현재 비밀번호"
                    placeholderTextColor="#C8B4B8"
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry
                  />
                  <TextInput
                    style={[s.input, { marginTop: 10 }]}
                    placeholder="새 이메일"
                    placeholderTextColor="#C8B4B8"
                    value={newEmail}
                    onChangeText={setNewEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={[s.saveBtn, { marginTop: 24 }, (!currentPassword || !newEmail.trim()) && s.saveBtnOff]}
                    onPress={handleChangeEmail}
                    disabled={!currentPassword || !newEmail.trim() || updatingAccount}
                  >
                    {updatingAccount
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={s.saveBtnTxt}>변경하기</Text>}
                  </TouchableOpacity>
                </>
              )}

              <View style={{ position: 'absolute', bottom: -50, left: 0, right: 0, height: 50, backgroundColor: '#fff' }} pointerEvents="none" />
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 4,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAE6E1',
    padding: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FAD0D8',
  },
  profileInfo: { flex: 1 },
  nicknameText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2D1B1E',
  },
  editBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F5ECEE',
  },
  editBtnTxt: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 13,
    color: '#F17088',
  },

  disconnectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF0F3',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F9C0CB',
  },
  disconnectBannerText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#C0455E',
    flex: 1,
  },
  disconnectCancelBtn: {
    marginLeft: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#F17088',
  },
  disconnectCancelTxt: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 12,
    color: '#fff',
  },

  section: { marginHorizontal: 20, marginTop: 20 },
  sectionTitle: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 12,
    color: '#9B8B8E',
    marginBottom: 8,
    letterSpacing: 0.4,
  },

  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAE6E1',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  menuBorder: {
    borderBottomWidth: 1,
    borderColor: '#F5ECEE',
  },
  menuLabel: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
  },
  menuLabelDim: { color: '#C4A0A8' },
  badge: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 11,
    color: '#C4A0A8',
    backgroundColor: '#F5ECEE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  chevron: { fontSize: 20, color: '#C4A0A8', lineHeight: 24 },
  valueDim: { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#9B8B8E' },
  valueGreen: { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#4CAF50' },

  logoutBtn: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAE6E1',
    paddingVertical: 15,
    alignItems: 'center',
  },
  logoutTxt: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 15,
    color: '#E05070',
  },

  devBtn: {
    backgroundColor: '#FFF3E0',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFD0A0',
    paddingVertical: 15,
    alignItems: 'center',
  },
  devBtnTxt: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 14,
    color: '#E65100',
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 44,
    paddingTop: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#EDD5DA', alignSelf: 'center', marginBottom: 20,
  },
  modalTitle: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 18,
    color: '#2D1B1E',
    marginBottom: 8,
  },
  modalDesc: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#9B8B8E',
    marginBottom: 20,
    lineHeight: 20,
  },

  avatarWrap: { alignSelf: 'center', marginBottom: 20 },
  avatarPick: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FAD0D8',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAE6E1',
    alignItems: 'center',
    justifyContent: 'center',
  },

  input: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5ECEE',
    paddingHorizontal: 18,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
  },
  saveBtn: {
    marginTop: 24,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnOff: { backgroundColor: '#DDACB5' },
  saveBtnTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#fff',
  },
});
