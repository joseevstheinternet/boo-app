import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref as sRef, uploadBytes } from 'firebase/storage';
import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../../contexts/ProfileContext';
import { usePartnerProfile } from '../../contexts/PartnerProfileContext';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  ImageBackground,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../firebaseConfig';

const { width: SW, height: SH } = Dimensions.get('window');
// 배너 크롭 출력 크기 — 실제 표시 비율((SW-40):200)을 3배 스케일로 유지
const BANNER_CROP_W = Math.round((SW - 40) * 3);
const BANNER_CROP_H = 600; // 200 * 3

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const CELL      = 16;
const ALBUM_COL_W = 120;
const ALBUM_GAP   = 20;
const GAP       = 2;
const WEEK_W    = CELL + GAP;

const GRASS_COLORS = [
  '#F0ECE8',  // 데이터 없음
  '#E8C5C8',
  '#DD9DA7',
  '#D37787',
  '#C95369',
  '#BF2E49',
];

const MONTH_KR = ['1','2','3','4','5','6','7','8','9','10','11','12'];

const TAPE = [
  require('../../assets/images/tape-1.png'),
  require('../../assets/images/tape-2.png'),
  require('../../assets/images/tape-3.png'),
  require('../../assets/images/tape-4.png'),
  require('../../assets/images/tape-5.png'),
  require('../../assets/images/tape-6.png'),
  require('../../assets/images/tape-7.png'),
  require('../../assets/images/tape-8.png'),
  require('../../assets/images/tape-9.png'),
  require('../../assets/images/tape-10.png'),
];

const MILESTONES: { days: number; label: string }[] = [
  { days: 100, label: '100일' }, { days: 200, label: '200일' }, { days: 300, label: '300일' },
  { days: 365, label: '1년' },  { days: 500, label: '500일' }, { days: 730, label: '2년' },
  { days: 1000, label: '1000일' }, { days: 1095, label: '3년' }, { days: 1500, label: '1500일' },
  { days: 2000, label: '2000일' }, { days: 3000, label: '3000일' },
];

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface CoupleInfo { startDate: string; bannerImage: string; users: string[] }

interface Anniversary {
  id: string; name: string; date: string;
  repeat: boolean; countFromDate: boolean;
  isPrimary: boolean;
}

interface AlbumItem {
  id: string; type: string; imageUrl: string;
  tapeIndex: number; tapeRotation: number;
  width: number; height: number;
  createdAt: Timestamp | null;
  createdBy: string;
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// daily 컬렉션 키: 로컬 시간 기준 YYYY-MM-DD
function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function grassLevel(n: number): number {
  if (n === 0)   return 0;
  if (n < 100)   return 1;
  if (n < 300)   return 2;
  if (n < 500)   return 3;
  if (n < 1000)  return 4;
  return 5;
}

function tooltipMsg(count: number): string {
  if (count === 0)   return '대화 없음';
  if (count < 100)   return '짧게 나눴어요';
  if (count < 300)   return '꽤 많이 했네요 ☺️';
  if (count < 500)   return '수다쟁이들 💬';
  if (count < 1000)  return '종일 붙어 있었네요 🥰';
  return '오늘 무슨 일 있었어요? ❤️‍🔥';
}

function calcDday(ann: Anniversary): string {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const d    = new Date(ann.date); d.setHours(0, 0, 0, 0);
  if (ann.repeat) {
    d.setFullYear(base.getFullYear());
    if (d < base) d.setFullYear(base.getFullYear() + 1);
  }
  const diff = Math.round((d.getTime() - base.getTime()) / 86400000);
  if (diff === 0) return '오늘이에요!';
  if (diff > 0)   return `D-${diff}`;
  return `D+${ann.countFromDate ? -diff + 1 : -diff}`;
}

function coupleDay(startStr: string): number {
  const s = new Date(startStr); s.setHours(0, 0, 0, 0);
  const t = new Date();         t.setHours(0, 0, 0, 0);
  return Math.floor((t.getTime() - s.getTime()) / 86400000) + 1;
}

// ─── HomePhotoItem ────────────────────────────────────────────────────────────

function HomePhotoItem({ item }: { item: AlbumItem }) {
  const [photoH, setPhotoH] = useState<number | null>(null);

  useEffect(() => {
    if (!item.imageUrl) return;
    Image.getSize(
      item.imageUrl,
      (w, h) => setPhotoH(Math.round((h / w) * ALBUM_COL_W)),
      () => setPhotoH(ALBUM_COL_W),
    );
  }, [item.imageUrl]);

  if (photoH === null) return <View style={{ width: ALBUM_COL_W, height: Math.round(ALBUM_COL_W * 0.75) }} />;

  return (
    <TouchableOpacity
      style={{ width: ALBUM_COL_W, height: photoH }}
      activeOpacity={0.85}
      onPress={async () => {
        await AsyncStorage.setItem('pendingAlbumItemId', item.id);
        router.push('/(tabs)/album');
      }}
    >
      <View style={[s.photoFrame, { width: ALBUM_COL_W, height: photoH }]}>
        <ExpoImage
          source={{ uri: item.imageUrl }}
          style={{ width: ALBUM_COL_W, height: photoH }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      </View>
      <Image
        source={TAPE[item.tapeIndex - 1]}
        style={[s.tape, { transform: [{ rotate: `${item.tapeRotation}deg` }] }]}
        resizeMode="contain"
      />
    </TouchableOpacity>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const me      = useProfile();
  const partner = usePartnerProfile();

  const [loading, setLoading]           = useState(true);
  const [coupleId, setCoupleId]         = useState('');
  const [couple, setCouple]             = useState<CoupleInfo | null>(null);
  const [bannerUri, setBannerUri]       = useState('');
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [dailyCounts, setDailyCounts]   = useState<Record<string, number>>({});
  const [tooltip, setTooltip]           = useState<{ dateStr: string; count: number } | null>(null);
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [albumItems, setAlbumItems]     = useState<AlbumItem[]>([]);
  const [uploadingAlbum, setUploadingAlbum] = useState(false);

  // 기념일 모달
  const [annModal, setAnnModal]         = useState(false);
  const [annName, setAnnName]           = useState('');
  const [annRepeat, setAnnRepeat]       = useState(false);
  const [annCountFrom, setAnnCountFrom] = useState(false);
  const [annIsBirthday, setAnnIsBirthday] = useState(false);
  const [savingAnn, setSavingAnn]       = useState(false);
  const [annDate, setAnnDate]           = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate]         = useState<Date>(new Date());

  // 프로필 모달
  const [profileModal, setProfileModal] = useState<{ visible: boolean; name: string; image: string; isMe: boolean }>({
    visible: false, name: '', image: '', isMe: false,
  });

  const grassScrollRef  = useRef<ScrollView>(null);
  const annScrollViewRef  = useRef<ScrollView>(null);
  const pickerSectionY    = useRef(0);
  const unsubCoupleRef  = useRef<(() => void) | null>(null);
  const unsubAlbumRef   = useRef<(() => void) | null>(null);
  const unsubDailyRef   = useRef<(() => void) | null>(null);
  const modalScrollY    = useRef(0);

  // 기념일 모달 애니메이션
  const annDimAnim   = useRef(new Animated.Value(0)).current;
  const annSheetAnim = useRef(new Animated.Value(300)).current;
  const [annModalVisible, setAnnModalVisible] = useState(false);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) =>
      g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) && modalScrollY.current <= 0,
    onPanResponderMove: (_, g) => {
      if (g.dy > 0) annSheetAnim.setValue(g.dy);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.5) {
        setAnnModal(false);
      } else {
        Animated.spring(annSheetAnim, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  })).current;

  // ── 기념일 실시간 리스너 ─────────────────────────────────────────────────

  useEffect(() => {
    if (!coupleId) return;
    const unsub = onSnapshot(
      collection(db, 'couples', coupleId, 'anniversaries'),
      snap => {
        setAnniversaries(snap.docs.map(d => ({
          id: d.id, name: d.data().name, date: d.data().date,
          repeat: d.data().repeat ?? false,
          countFromDate: d.data().countFromDate ?? false,
          isPrimary: d.data().isPrimary ?? false,
        })));
      },
      _err => {},
    );
    return () => unsub();
  }, [coupleId]);

  // ── daily 카운트 로드 (12주 범위만) ────────────────────────────────────

  // ── 데이터 로딩 ──────────────────────────────────────────────────────────

  useEffect(() => {
    load();
    return () => { unsubCoupleRef.current?.(); };
  }, []);

  async function load() {
    try {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
      if (!uid || !cid) { setLoading(false); return; }
      setCoupleId(cid);

      unsubCoupleRef.current?.();
      unsubCoupleRef.current = onSnapshot(
        doc(db, 'couples', cid),
        snap => {
          if (snap.exists()) {
            const d = snap.data();
            const startDate: string =
              d.startDate ?? toDateStr((d.createdAt as Timestamp)?.toDate() ?? new Date());
            setCouple({ startDate, bannerImage: d.bannerImage ?? '', users: d.users ?? [] });
            setBannerUri(d.bannerImage ?? '');
          }
          setLoading(false);
        },
        () => setLoading(false),
      );
    } catch (e) {
      setLoading(false);
    }
  }

  // ── 앨범 실시간 리스너 ──────────────────────────────────────────────────

  useEffect(() => {
    if (!coupleId) return;
    unsubAlbumRef.current?.();
    unsubAlbumRef.current = onSnapshot(
      collection(db, 'couples', coupleId, 'album'),
      snap => {
        const items: AlbumItem[] = snap.docs.map(d => ({
          id: d.id,
          type: d.data().type ?? 'photo',
          imageUrl: d.data().imageUrl,
          tapeIndex: d.data().tapeIndex,
          tapeRotation: d.data().tapeRotation,
          width: d.data().width ?? SW,
          height: d.data().height ?? SW,
          createdAt: d.data().createdAt ?? null,
          createdBy: d.data().createdBy ?? '',
        }));
        items.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setAlbumItems(items);
      },
      _err => {},
    );
    return () => unsubAlbumRef.current?.();
  }, [coupleId]);

  // ── 잔디 실시간 리스너 ──────────────────────────────────────────────────

  useEffect(() => {
    if (!coupleId) return;
    unsubDailyRef.current?.();
    unsubDailyRef.current = onSnapshot(
      collection(db, 'couples', coupleId, 'daily'),
      snap => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const keys: string[] = [];
        for (let i = 111; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          keys.push(toKey(d));
        }
        const counts: Record<string, number> = {};
        snap.forEach(d => {
          if (keys.includes(d.id)) counts[d.id] = d.data().count ?? 0;
        });
        setDailyCounts(counts);
      },
      _err => {},
    );
    return () => unsubDailyRef.current?.();
  }, [coupleId]);

  // ── 언마운트 정리 ────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      unsubAlbumRef.current?.();
      unsubDailyRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (annModal) {
      // 폼 초기화 — 새로 열 때마다 오늘 날짜로 리셋
      const today = new Date();
      setAnnName(''); setAnnRepeat(false); setAnnCountFrom(false);
      setAnnIsBirthday(false); setAnnDate(today); setTempDate(today); setShowDatePicker(false);
      annSheetAnim.setValue(300);
      setAnnModalVisible(true);
      Animated.parallel([
        Animated.timing(annDimAnim,   { toValue: 0.35, duration: 250, useNativeDriver: false }),
        Animated.spring(annSheetAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(annDimAnim,   { toValue: 0, duration: 200, useNativeDriver: false }),
        Animated.timing(annSheetAnim, { toValue: 300, duration: 200, useNativeDriver: false }),
      ]).start(() => setAnnModalVisible(false));
    }
  }, [annModal]);

  // ── 배너 업로드 ──────────────────────────────────────────────────────────

  async function handlePickBanner() {
    Alert.alert('임시 비활성화', '현재 업데이트 중이에요.');
  }

  // ── 기념일 저장 ──────────────────────────────────────────────────────────

  async function handleSaveAnn() {
    if (!annName.trim()) return;
    setSavingAnn(true);
    try {
      const dateStr = `${annDate.getFullYear()}-${String(annDate.getMonth() + 1).padStart(2, '0')}-${String(annDate.getDate()).padStart(2, '0')}`;
      await addDoc(collection(db, 'couples', coupleId, 'anniversaries'), {
        name: annName.trim(), date: dateStr,
        repeat: annRepeat, countFromDate: annCountFrom, isPrimary: anniversaries.length === 0,
      });
      setAnnName(''); setAnnRepeat(false); setAnnCountFrom(false);
      setAnnIsBirthday(false); setAnnDate(new Date()); setShowDatePicker(false);
    } catch { Alert.alert('저장에 실패했어요.'); }
    finally { setSavingAnn(false); }
  }

  // ── 대표 기념일 설정 ─────────────────────────────────────────────────────

  async function handleSetPrimary(id: string) {
    try {
      const batch = writeBatch(db);
      anniversaries.forEach(a => {
        batch.update(doc(db, 'couples', coupleId, 'anniversaries', a.id), {
          isPrimary: a.id === id,
        });
      });
      await batch.commit();
    } catch (e) {
      // error silently ignored
    }
  }

  // ── 기념일 삭제 ──────────────────────────────────────────────────────────

  async function handleDeleteAnn(id: string) {
    Alert.alert('삭제', '기념일을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'couples', coupleId, 'anniversaries', id));
          } catch {
            Alert.alert('삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  // ── 앨범 업로드 ──────────────────────────────────────────────────────────

  async function handlePickAlbum() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('갤러리 접근 권한이 필요해요.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingAlbum(true);
    try {
      const asset = result.assets[0];
      const blob = await fetch(asset.uri).then(r => r.blob());
      const storage = getStorage(auth.app);
      const ref = sRef(storage, `albums/${coupleId}/${Date.now()}.jpg`);
      await uploadBytes(ref, blob);
      const url = await getDownloadURL(ref);
      const tapeIndex    = Math.floor(Math.random() * 10) + 1;
      const tapeRotation = Math.round(Math.random() * 10 - 5);
      await addDoc(collection(db, 'couples', coupleId, 'album'), {
        type: 'photo',
        imageUrl: url, tapeIndex, tapeRotation,
        width: asset.width, height: asset.height, createdAt: Timestamp.now(),
        createdBy: auth.currentUser?.uid ?? '',
      });
    } catch { Alert.alert('업로드에 실패했어요.'); }
    finally { setUploadingAlbum(false); }
  }

  // ── 잔디 그리드 계산 (17주 고정 윈도우) ─────────────────────────────────

  type GrassDay = { date: Date; isToday: boolean; isFuture: boolean };

  function buildGrid(): { weeks: GrassDay[][]; totalCount: number; monthLabels: (string | null)[] } {
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const todaySun = new Date(today); todaySun.setDate(today.getDate() - today.getDay());

    // 17주 전 날짜의 해당 주 일요일 → 그리드 시작점
    const weeksAgo16 = new Date(today); weeksAgo16.setDate(today.getDate() - 16 * 7);
    const firstSun   = new Date(weeksAgo16); firstSun.setDate(weeksAgo16.getDate() - weeksAgo16.getDay());

    const weeks: GrassDay[][] = [];
    const cur = new Date(firstSun);
    while (cur <= todaySun) {
      const week: GrassDay[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(cur); day.setDate(cur.getDate() + d);
        week.push({
          date:     day,
          isToday:  day.getTime() === today.getTime(),
          isFuture: day.getTime() > today.getTime(),
        });
      }
      weeks.push(week);
      cur.setDate(cur.getDate() + 7);
    }

    const monthLabels: (string | null)[] = [];
    let lastMonth = -1;
    weeks.forEach(w => {
      const m = w[0].date.getMonth();
      monthLabels.push(m !== lastMonth ? MONTH_KR[m] : null);
      lastMonth = m;
    });

    let totalCount = 0;
    weeks.forEach(week =>
      week.forEach(day => {
        if (!day.isFuture) totalCount += dailyCounts[toKey(day.date)] ?? 0;
      })
    );

    return { weeks, totalCount, monthLabels };
  }

  const { weeks, totalCount, monthLabels } = buildGrid();
  const primaryAnn = anniversaries.find(a => a.isPrimary) ?? null;

  const nextMilestones = (() => {
    const baseStr = primaryAnn ? primaryAnn.date : couple?.startDate;
    if (!baseStr) return [];
    const start = new Date(baseStr); start.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const currentDays = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
    return MILESTONES
      .filter(m => m.days > currentDays)
      .slice(0, 2)
      .map(m => {
        const d = new Date(start);
        d.setDate(start.getDate() + m.days - 1);
        const remaining = Math.round((d.getTime() - today.getTime()) / 86400000);
        const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        return { label: m.label, dateStr, remaining };
      });
  })();

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF5F7' }}>
        <ActivityIndicator color="#F17088" size="large" />
      </View>
    );
  }

  const days = couple ? coupleDay(primaryAnn ? primaryAnn.date : couple.startDate) : 0;

  return (
    <ImageBackground
      source={require('../../assets/images/wallpaper-star-p.png')}
      style={{ flex: 1 }}
      resizeMode="cover"
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardDismissMode="on-drag">

          {/* ── 커플 헤더 ─────────────────────────────────────────────── */}
          <View style={s.header}>
            {/* 상대방 */}
            <View style={s.avatarCol}>
              <TouchableOpacity
                onPress={() => setProfileModal({ visible: true, name: partner.nickname, image: partner.profileImage, isMe: false })}
                activeOpacity={0.85}
              >
                <View style={s.avatarRing}>
                  <ExpoImage
                    source={partner.profileImage
                      ? { uri: partner.profileImage }
                      : require('../../assets/images/profile-default.png')}
                    style={s.avatarImg}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </View>
              </TouchableOpacity>
            </View>

            {/* 중앙 — D-day 카드 */}
            <View style={s.centerBox}>
              <TouchableOpacity onPress={() => setAnnModal(true)} style={{ alignItems: 'center' }}>
                {primaryAnn ? (
                  <>
                    <Text style={s.sinceLabel}>{primaryAnn.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={s.daysCount}>{days}</Text>
                      <Text style={[s.daysCount, { marginLeft: 2 }]}>일</Text>
                    </View>
                  </>
                ) : (
                  <Text style={s.addAnnLabel}>기념일 추가 +</Text>
                )}
              </TouchableOpacity>
              <View style={s.namesRow}>
                <Text style={s.namesLabel}>{partner.nickname || '?'}</Text>
                <Text style={s.heart}>♥</Text>
                <Text style={s.namesLabel}>{me.nickname || '?'}</Text>
              </View>
            </View>

            {/* 나 */}
            <View style={s.avatarCol}>
              <TouchableOpacity
                onPress={() => setProfileModal({ visible: true, name: me.nickname, image: me.profileImage, isMe: true })}
                activeOpacity={0.85}
              >
                <View style={s.avatarRing}>
                  <ExpoImage
                    source={me.profileImage
                      ? { uri: me.profileImage }
                      : require('../../assets/images/profile-default.png')}
                    style={s.avatarImg}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── 배너 사진 ─────────────────────────────────────────────── */}
          <View style={s.bannerWrap}>
            {bannerUri ? (
              <View style={s.bannerBox}>
                <ExpoImage source={{ uri: bannerUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" priority="high" recyclingKey={bannerUri} />
                {uploadingBanner && (
                  <View style={s.bannerOverlay}><ActivityIndicator color="#fff" /></View>
                )}
                <TouchableOpacity style={s.editBtn} onPress={handlePickBanner} hitSlop={8}>
                  <Image source={require('../../assets/images/write.png')} style={{ width: 20, height: 20 }} resizeMode="contain" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={s.bannerEmpty} onPress={handlePickBanner} activeOpacity={0.8}>
                {uploadingBanner
                  ? <ActivityIndicator color="#F17088" />
                  : <Text style={s.bannerEmptyTxt}>우리를 나타낼 사진을 추가해요!</Text>}
                <View style={s.editBtn}>
                  <Image source={require('../../assets/images/write.png')} style={{ width: 20, height: 20 }} resizeMode="contain" />
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* ── 잔디 섹션 ─────────────────────────────────────────────── */}
          <View style={s.card}>
            {/* 배경 블러 */}
            <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />

            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>우리의 대화</Text>
              <Text style={s.grassTotal}>{totalCount.toLocaleString()}개의 메시지</Text>
            </View>

            <ScrollView
              ref={grassScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingRight: 16, paddingBottom: 12 }}
              onContentSizeChange={() =>
                grassScrollRef.current?.scrollToEnd({ animated: false })
              }
            >
              <View>
                <View style={{ flexDirection: 'row', height: 16, marginBottom: 4 }}>
                  {monthLabels.map((lbl, wi) => (
                    <View key={wi} style={{ width: WEEK_W }}>
                      {lbl && <Text style={s.monthLbl}>{lbl}</Text>}
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: GAP }}>
                  {weeks.map((week, wi) => (
                    <View key={wi} style={{ flexDirection: 'column', gap: GAP }}>
                      {week.map((day, di) => {
                        if (day.isFuture) {
                          return <View key={di} style={[s.cell, { backgroundColor: 'transparent' }]} />;
                        }
                        const ds  = toKey(day.date);
                        const cnt = dailyCounts[ds] ?? 0;
                        const lv  = grassLevel(cnt);
                        return (
                          <TouchableOpacity
                            key={di}
                            style={[
                              s.cell,
                              { backgroundColor: GRASS_COLORS[lv] },
                              day.isToday && s.cellToday,
                            ]}
                            onPress={() => setTooltip({ dateStr: ds, count: cnt })}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>

            <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}>
              <View style={s.legend}>
                {GRASS_COLORS.map((c, i) => (
                  <View key={i} style={[s.legendCell, { backgroundColor: c }, i === 0 && s.cellEmpty]} />
                ))}
              </View>
              {tooltip && (() => {
                const d = new Date(tooltip.dateStr + 'T00:00:00');
                return (
                  <View style={s.tooltip}>
                    <View style={[s.tooltipDot, { backgroundColor: GRASS_COLORS[grassLevel(tooltip.count)] }]} />
                    <Text style={s.tooltipTxt}>
                      {d.getMonth() + 1}월 {d.getDate()}일 · {tooltip.count.toLocaleString()}개 · {tooltipMsg(tooltip.count)}
                    </Text>
                  </View>
                );
              })()}
            </View>
          </View>

          {/* ── 앨범 ──────────────────────────────────────────────────── */}
          <View style={[s.section, { marginTop: 14 }]}>
            {albumItems.length === 0 ? null : (() => {
              const left  = albumItems.filter((_, i) => i % 2 === 0);
              const right = albumItems.filter((_, i) => i % 2 === 1);
              return (
                <View style={s.albumGrid}>
                  <View style={[s.albumCol, { width: ALBUM_COL_W }]}>{left.map(item => <HomePhotoItem key={item.id} item={item} />)}</View>
                  <View style={[s.albumCol, { width: ALBUM_COL_W }]}>{right.map(item => <HomePhotoItem key={item.id} item={item} />)}</View>
                </View>
              );
            })()}
          </View>

        </ScrollView>
      </SafeAreaView>
      </TouchableWithoutFeedback>

      {/* ── 프로필 모달 ───────────────────────────────────────────────────── */}
      <Modal
        visible={profileModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileModal(p => ({ ...p, visible: false }))}
      >
        <Pressable
          style={s.profileBackdrop}
          onPress={() => setProfileModal(p => ({ ...p, visible: false }))}
        >
          <Pressable style={s.profileBox} onPress={e => e.stopPropagation()}>
            <ExpoImage
              source={profileModal.image
                ? { uri: profileModal.image }
                : require('../../assets/images/profile-default.png')}
              style={s.profileBigImg}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <Text style={s.profileBigName}>{profileModal.name || '?'}</Text>
            {profileModal.isMe && (
              <TouchableOpacity
                style={s.profileEditBtn}
                onPress={async () => { setProfileModal(p => ({ ...p, visible: false })); await AsyncStorage.setItem('openProfileEdit', '1'); router.push('/(tabs)/more'); }}
                activeOpacity={0.8}
              >
                <Text style={s.profileEditTxt}>편집</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 기념일 추가 모달 ──────────────────────────────────────────────── */}
      <Modal visible={annModalVisible} transparent animationType="none" onRequestClose={() => setAnnModal(false)}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: annDimAnim }]}
          pointerEvents="none"
        />
        <Pressable style={s.backdrop} onPress={() => setAnnModal(false)}>
          <Animated.View style={{ transform: [{ translateY: annSheetAnim }] }}>
          <Pressable style={s.sheet} onPress={() => Keyboard.dismiss()}>

            {/* 드래그 핸들 */}
            <View {...panResponder.panHandlers} style={{ paddingBottom: 4, alignItems: 'center' }}>
              <View style={s.handle} />
            </View>
            <Text style={s.modalTitle}>기념일</Text>

            {/* 스크롤 가능한 내용 영역 */}
            <ScrollView
              ref={annScrollViewRef}
              style={{ maxHeight: SH * 0.72 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 40 }}
              onScroll={e => { modalScrollY.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
            >

              {/* 대표 기념일 + 마일스톤 */}
              {couple && primaryAnn && (
                <View style={{ marginBottom: 20 }}>
                  {nextMilestones.map((m, i) => (
                    <View key={i} style={[s.milestoneCard, i > 0 && { marginTop: 8 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.milestoneName}>{m.label} 🎉</Text>
                        <Text style={s.milestoneDate}>{m.dateStr}</Text>
                      </View>
                      <Text style={s.milestoneDday}>D-{m.remaining}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* 기존 기념일 목록 */}
              {anniversaries.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <Text style={s.modalSubTitle}>기념일 목록</Text>
                    <Text style={{ fontSize: 11, color: '#B0A0A4' }}>탭하면 대표 기념일로 설정돼요</Text>
                  </View>
                  <View style={{ gap: 8 }}>
                    {anniversaries.map(ann => (
                      <TouchableOpacity
                        key={ann.id}
                        style={[s.annItem, ann.isPrimary && s.annItemPrimary]}
                        onPress={() => handleSetPrimary(ann.id)}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons
                          name={ann.isPrimary ? 'heart' : 'heart-outline'}
                          size={20}
                          color={ann.isPrimary ? '#F17088' : '#C8B4B8'}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[s.annName, ann.isPrimary && { color: '#F17088' }]}>{ann.name}</Text>
                            {ann.isPrimary && (
                              <View style={s.primaryBadge}>
                                <Text style={s.primaryBadgeTxt}>대표</Text>
                              </View>
                            )}
                          </View>
                          <Text style={s.annDate}>{ann.date.replace(/-/g, '.')}</Text>
                        </View>
                        <Text style={s.dday}>{calcDday(ann)}</Text>
                        <TouchableOpacity
                          onPress={e => { e.stopPropagation(); handleDeleteAnn(ann.id); }}
                          style={{ marginLeft: 8, padding: 4 }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Text style={{ fontSize: 13, color: '#C4A0A8' }}>✕</Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* 기념일 추가 폼 */}
              <Text style={s.modalSubTitle}>기념일 추가</Text>
              <TextInput
                style={s.annInput}
                placeholder="기념일 이름 (예: 처음 만난 날)"
                placeholderTextColor="#C8B4B8"
                value={annName}
                onChangeText={setAnnName}
                onFocus={() => setTimeout(() => annScrollViewRef.current?.scrollToEnd({ animated: true }), 300)}
              />

              {/* 날짜 선택 버튼 + 인라인 DatePicker */}
              <View onLayout={e => { pickerSectionY.current = e.nativeEvent.layout.y; }}>
                <TouchableOpacity
                  style={s.datePickerBtn}
                  onPress={() => {
                    setTempDate(annDate);
                    const opening = !showDatePicker;
                    setShowDatePicker(v => !v);
                    if (opening) {
                      setTimeout(() => {
                        const PICKER_H = 290;
                        const SCROLL_H = SH * 0.72;
                        const targetY = pickerSectionY.current - (SCROLL_H - PICKER_H) / 2;
                        annScrollViewRef.current?.scrollTo({ y: Math.max(0, targetY), animated: true });
                      }, 150);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={s.datePickerBtnTxt}>
                    {showDatePicker
                      ? `${tempDate.getFullYear()}년 ${tempDate.getMonth() + 1}월 ${tempDate.getDate()}일`
                      : `${annDate.getFullYear()}년 ${annDate.getMonth() + 1}월 ${annDate.getDate()}일`}
                  </Text>
                  <MaterialCommunityIcons name="calendar-outline" size={16} color="#C4A0A8" />
                </TouchableOpacity>

                {showDatePicker && (
                  <View style={s.inlinePicker}>
                    <DateTimePicker
                      value={tempDate ?? new Date()}
                      maximumDate={new Date()}
                      mode="date"
                      display="spinner"
                      onChange={(_, d) => { if (d) { setTempDate(d); setAnnDate(d); } }}
                      locale="ko-KR"
                      textColor="#121212"
                      style={{ width: '100%' }}
                    />
                    <TouchableOpacity
                      style={s.pickerConfirmBtn}
                      onPress={() => setShowDatePicker(false)}
                    >
                      <Text style={s.pickerConfirmTxt}>완료</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>


              {/* 생일 체크박스 */}
              <TouchableOpacity
                style={s.birthdayRow}
                onPress={() => {
                  const next = !annIsBirthday;
                  setAnnIsBirthday(next);
                  if (next) setAnnRepeat(true);
                  else setAnnRepeat(false);
                }}
                activeOpacity={0.8}
              >
                <View style={[s.checkbox, annIsBirthday && s.checkboxOn]}>
                  {annIsBirthday && <Text style={{ fontSize: 12, color: '#fff', lineHeight: 16 }}>✓</Text>}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MaterialCommunityIcons name="cake-variant-outline" size={16} color={annIsBirthday ? '#F17088' : '#9B8B8E'} />
                  <Text style={s.toggleLbl}>생일이에요</Text>
                </View>
              </TouchableOpacity>

              <View style={s.toggleRow}>
                <Text style={[s.toggleLbl, annIsBirthday && { color: '#C4A0A8' }]}>매년 반복</Text>
                <Switch
                  value={annRepeat}
                  onValueChange={v => { if (!annIsBirthday) setAnnRepeat(v); }}
                  trackColor={{ false: '#EDD5DA', true: '#F17088' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#EDD5DA"
                  disabled={annIsBirthday}
                />
              </View>
              <View style={s.toggleRow}>
                <Text style={s.toggleLbl}>설정일을 1일로</Text>
                <Switch
                  value={annCountFrom}
                  onValueChange={setAnnCountFrom}
                  trackColor={{ false: '#EDD5DA', true: '#F17088' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#EDD5DA"
                />
              </View>

              <TouchableOpacity
                style={[s.saveBtn, !annName.trim() && s.saveBtnOff]}
                onPress={handleSaveAnn}
                disabled={!annName.trim() || savingAnn}
              >
                {savingAnn
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnTxt}>저장하기</Text>}
              </TouchableOpacity>

            </ScrollView>
          </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </ImageBackground>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.1,
  shadowRadius: 10,
  elevation: 5,
};

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28,
  },
  avatarCol:  { alignItems: 'center', width: 64 },
  avatarRing: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: '#FAD0D8', overflow: 'hidden',
    borderWidth: 2.5, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg:      { width: 50, height: 50 },
  avatarFallback: { fontSize: 22 },
  centerBox:      { flex: 1, alignItems: 'center' },
  sinceLabel:     { fontFamily: 'NotoSansKR-Regular', fontSize: 11, color: '#9B8B8E' },
  addAnnLabel:    { fontFamily: 'NotoSansKR-Regular', fontSize: 16, color: '#9B8B8E' },
  daysCount:      { fontFamily: 'Pretendard-Bold', fontSize: 20, color: '#2D1B1E', lineHeight: 26 },
  namesRow:       { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  namesLabel:     { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#9B8B8E' },
  heart:          { fontSize: 11, color: '#F17088' },

  // 배너: marginTop 0 (header paddingBottom이 gap 담당), marginBottom 20
  bannerWrap: { marginHorizontal: 20, marginBottom: 20 },
  bannerBox: {
    height: 200, borderRadius: 18, overflow: 'hidden', position: 'relative',
    backgroundColor: '#F5ECEE',
    borderWidth: 1, borderColor: '#FFFFFF',
    ...SHADOW,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  bannerEmpty: {
    height: 200, backgroundColor: 'rgba(250,232,236,0.85)',
    borderRadius: 18, alignItems: 'center', justifyContent: 'center', position: 'relative',
    borderWidth: 1, borderColor: '#FFFFFF',
    ...SHADOW,
  },
  bannerEmptyTxt: { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#C4A0A8' },
  editBtn: { position: 'absolute', bottom: 10, right: 10 },

  // 잔디 카드: BlurView + 반투명 배경 + 흰 테두리 + 그림자
  card: {
    marginHorizontal: 20, marginBottom: 25,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 18, borderWidth: 1, borderColor: '#FFFFFF',
    overflow: 'hidden',
    ...SHADOW,
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingBottom: 10,
  },
  cardTitle:  { fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#2D1B1E' },
  grassTotal: { fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#9B8B8E' },
  monthLbl:   { fontFamily: 'Pretendard-Regular', fontSize: 9, color: '#9B8B8E' },
  cell:       { width: CELL, height: CELL, borderRadius: 3 },
  cellEmpty:  { borderWidth: 1, borderColor: '#EAE6E1' },
  cellToday:  { borderWidth: 2, borderColor: '#F17088' },
  tooltip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F5ECEE', borderRadius: 10, padding: 10,
  },
  tooltipDot:  { width: 12, height: 12, borderRadius: 4 },
  tooltipTxt:  { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#2D1B1E', lineHeight: 16 },
  legend:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 1 },
  legendCell:  { width: 11, height: 11, borderRadius: 2 },

  // 공통 섹션
  section: { marginHorizontal: 20, marginBottom: 16 },
  emptyBox: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 14, borderWidth: 1, borderColor: '#EAE6E1',
    padding: 20, alignItems: 'center',
  },
  emptyTxt: { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#C4A0A8' },

  // 기념일 아이템
  annItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 14, borderWidth: 1, borderColor: '#EAE6E1', padding: 14,
  },
  annItemPrimary: {
    backgroundColor: '#FFF0F3',
    borderColor: '#F17088',
  },
  primaryBadge: {
    backgroundColor: '#F17088', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  primaryBadgeTxt: { fontFamily: 'Pretendard-Bold', fontSize: 10, color: '#fff' },
  annName: { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#2D1B1E' },
  annDate: { fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#9B8B8E', marginTop: 1 },
  dday:    { fontFamily: 'Pretendard-Bold', fontSize: 12, color: '#F17088' },

  // 앨범
  albumGrid: {
    flexDirection: 'row',
    gap: ALBUM_GAP,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  albumCol:   { gap: ALBUM_GAP },
  photoFrame: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F9F9F9',
  },
  tape: {
    position: 'absolute', top: -14, alignSelf: 'center',
    width: 80, height: 28,
  },

  // 프로필 모달
  profileBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  profileBox: {
    backgroundColor: '#fff', borderRadius: 24,
    paddingHorizontal: 32, paddingVertical: 28,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  profileBigImg: {
    width: 120, height: 120, borderRadius: 60,
    marginBottom: 16, backgroundColor: '#FAD0D8',
  },
  profileBigName: {
    fontFamily: 'Pretendard-SemiBold', fontSize: 18, color: '#2D1B1E',
  },
  profileEditBtn: {
    marginTop: 14,
    paddingHorizontal: 20, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: '#E8D5D9',
  },
  profileEditTxt: {
    fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#F17088',
  },

  // 기념일 모달
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#EDD5DA', alignSelf: 'center', marginBottom: 12,
  },
  // 마일스톤 카드
  milestoneCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF0F3', borderRadius: 14,
    borderWidth: 1, borderColor: '#FAD0D8',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  milestoneName: { fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#2D1B1E', marginBottom: 2 },
  milestoneDate: { fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#9B8B8E' },
  milestoneDday: { fontFamily: 'Pretendard-Bold', fontSize: 13, color: '#F17088' },
  // 인라인 DateTimePicker
  inlinePicker: {
    backgroundColor: '#FFF8FA', borderRadius: 16,
    marginVertical: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: '#FAD0D8',
  },
  pickerConfirmBtn: {
    alignItems: 'center', paddingVertical: 12,
    borderTopWidth: 1, borderColor: '#FAD0D8',
  },
  pickerConfirmTxt: { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#F17088' },
  // 생일 체크박스
  birthdayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, borderBottomWidth: 1, borderColor: '#F5ECEE',
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#C4A0A8',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#F17088', borderColor: '#F17088' },
  modalTitle:    { fontFamily: 'Pretendard-Bold', fontSize: 18, color: '#2D1B1E', marginBottom: 16 },
  modalSubTitle: { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#2D1B1E', marginBottom: 12 },
  annInput: {
    height: 48, borderRadius: 24, backgroundColor: '#F5ECEE',
    paddingHorizontal: 18, fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E',
    marginBottom: 16,
  },
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5ECEE',
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  datePickerBtnTxt: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#2D1B1E',
  },
  toggleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 13, borderBottomWidth: 1, borderColor: '#F5ECEE',
  },
  toggleLbl: { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#2D1B1E' },
  saveBtn: {
    marginTop: 24, height: 52, borderRadius: 26,
    backgroundColor: '#F17088', alignItems: 'center', justifyContent: 'center',
  },
  saveBtnOff: { backgroundColor: '#DDACB5' },
  saveBtnTxt: { fontFamily: 'Pretendard-SemiBold', fontSize: 16, color: '#fff' },
});
