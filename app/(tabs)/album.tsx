import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref as sRef, uploadBytes } from 'firebase/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePartnerProfile } from '../../contexts/PartnerProfileContext';
import { auth, db, storage } from '../../firebaseConfig';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const ITEM_W    = 120;
const ITEM_GAP  = 20;
const PAD_H     = Math.max(16, (SW - 2 * ITEM_W - ITEM_GAP) / 2);
const FAB_BOT   = 110;
const FAB_W     = 52;

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

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type AlbumItemType = 'photo' | 'book' | 'movie';

interface AlbumItem {
  id: string;
  type: AlbumItemType;
  imageUrl: string;
  width?: number;
  height?: number;
  tapeIndex: number;
  tapeRotation: number;
  createdAt: Timestamp | null;
  createdBy: string;
  photo?: { caption: string };
  book?: { title: string; author: string; rating: number; review: string; startDate: string; endDate: string; status: 'reading' | 'done' };
  movie?: { title: string; rating: number; review: string; watchedDate: string; status: 'watching' | 'done' };
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function randomTape() {
  return {
    tapeIndex:    Math.floor(Math.random() * 10),
    tapeRotation: Math.round((Math.random() * 10 - 5) * 10) / 10,
  };
}

function isoToDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y}.${m}.${d}`;
}

function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function pickImage(): Promise<string | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') { Alert.alert('갤러리 접근 권한이 필요해요.'); return null; }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}

async function uploadToStorage(localUri: string, path: string): Promise<string> {
  const blob = await fetch(localUri).then(r => r.blob());
  const ref = sRef(storage, path);
  await uploadBytes(ref, blob);
  return getDownloadURL(ref);
}

// ─── AdaptiveImage ────────────────────────────────────────────────────────────

function AdaptiveImage({ uri, width, storedW, storedH }: { uri: string; width: number; storedW?: number; storedH?: number }) {
  const initial = storedW && storedH ? Math.round((storedH / storedW) * width) : null;
  const [height, setHeight] = useState<number | null>(initial);

  useEffect(() => {
    if (initial !== null) return;          // 저장된 치수 있으면 getSize 불필요
    if (!uri) return;
    Image.getSize(uri, (w, h) => setHeight(Math.round((h / w) * width)), () => setHeight(width));
  }, [uri]);

  if (height === null) return <View style={{ width, height: Math.round(width * 0.75), backgroundColor: '#F8F0F2' }} />;
  return <ExpoImage source={{ uri }} style={{ width, height }} contentFit="cover" cachePolicy="memory-disk" />;
}

// ─── StarRating ───────────────────────────────────────────────────────────────

function StarRating({
  value, onChange, size = 18,
}: {
  value: number; onChange?: (v: number) => void; size?: number;
}) {
  const GAP = 4;
  const STAR_W = size + GAP;
  const TOTAL_W = STAR_W * 5;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function valueFromX(x: number): number {
    const clamped = Math.max(0, Math.min(x, TOTAL_W));
    const raw = (clamped / TOTAL_W) * 5;
    return Math.max(0, Math.min(5, Math.ceil(raw * 2) / 2));
  }

  const pan = useRef(
    PanResponder.create({
      //onStartShouldSetPanResponder: () => false,                                   // 탭은 TouchableOpacity가 처리
      onStartShouldSetPanResponder: () => !!onChangeRef.current,
      onMoveShouldSetPanResponder:  (_, gs) => !!onChangeRef.current && (Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3),
      onPanResponderMove: (evt, gs) => {
        if (Math.abs(gs.dx) >= Math.abs(gs.dy)) {
          onChangeRef.current?.(valueFromX(evt.nativeEvent.locationX));
        }
      },
    }),
  ).current;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: GAP }} {...(onChange ? pan.panHandlers : {})}>
        {[1, 2, 3, 4, 5].map(i => {
          const isFull = value >= i;
          const isHalf = !isFull && value >= i - 0.5;
          return (
            <TouchableOpacity key={i} onPress={() => onChange?.(i)} activeOpacity={0.7} disabled={!onChange}>
              <Ionicons
                name={isFull ? 'star' : isHalf ? 'star-half' : 'star-outline'}
                size={size}
                color={isFull || isHalf ? '#FF6B8A' : '#E8D5D9'}
              />
            </TouchableOpacity>
          );
        })}
      </View>
      {value > 0 && (
        <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#FF6B8A' }}>{value}</Text>
      )}
    </View>
  );
}

// ─── DatePickerField ──────────────────────────────────────────────────────────

function DatePickerField({
  label, value, onChange,
}: {
  label: string; value: Date | null; onChange: (d: Date) => void;
}) {
  const [show, setShow] = useState(false);
  const [temp, setTemp] = useState<Date>(value ?? new Date());

  const displayText = value ? isoToDisplay(dateToIso(value)) : label;

  return (
    <View>
      <TouchableOpacity style={df.btn} onPress={() => { setTemp(value ?? new Date()); setShow(true); }}>
        <Text style={[df.txt, !value && df.placeholder]}>{displayText}</Text>
        <Ionicons name="calendar-outline" size={15} color="#C4A0A8" />
      </TouchableOpacity>

      {Platform.OS === 'ios' ? (
        <Modal visible={show} transparent animationType="fade">
          <Pressable style={df.overlay} onPress={() => setShow(false)}>
            <Pressable style={df.picker} onPress={e => e.stopPropagation()}>
              <View style={df.pickerHeader}>
                <TouchableOpacity onPress={() => setShow(false)}>
                  <Text style={df.cancel}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { onChange(temp); setShow(false); }}>
                  <Text style={df.done}>완료</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={temp}
                mode="date"
                display="spinner"
                onChange={(_, d) => d && setTemp(d)}
                locale="ko-KR"
                maximumDate={new Date()}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : (
        show && (
          <DateTimePicker
            value={temp}
            mode="date"
            display="default"
            onChange={(_, d) => { setShow(false); if (d) onChange(d); }}
            maximumDate={new Date()}
          />
        )
      )}
    </View>
  );
}

const df = StyleSheet.create({
  btn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44, borderRadius: 22, backgroundColor: '#F5ECEE', paddingHorizontal: 16 },
  txt:     { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#2D1B1E' },
  placeholder: { color: '#C8B4B8' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  picker:  { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 34 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  cancel:  { fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#9B8B8E' },
  done:    { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#F17088' },
});

// ─── ImagePickArea ────────────────────────────────────────────────────────────

function ImagePickArea({
  uri, onPick, height = 180,
}: {
  uri: string; onPick: () => void; height?: number;
}) {
  const fullWidth = SW - 40; // ScrollView contentContainerStyle paddingHorizontal 20 * 2
  const thumbWidth = fullWidth / 2;
  return (
    <TouchableOpacity style={[ip.wrap, !uri && { height }, uri && { alignSelf: 'center' }]} onPress={onPick} activeOpacity={0.8}>
      {uri ? (
        <AdaptiveImage uri={uri} width={thumbWidth} />
      ) : (
        <View style={ip.placeholder}>
          <Ionicons name="image-outline" size={32} color="#C8B4B8" />
          <Text style={ip.hint}>사진을 선택해주세요</Text>
        </View>
      )}
      {uri && (
        <View style={ip.changeOverlay}>
          <Text style={ip.changeTxt}>변경</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const ip = StyleSheet.create({
  wrap:        { borderRadius: 16, overflow: 'hidden', backgroundColor: '#F5ECEE' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  hint:        { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#C8B4B8' },
  changeOverlay: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  changeTxt:   { fontFamily: 'Pretendard-Medium', fontSize: 12, color: '#fff' },
});

// ─── ModalSheet (공통 바텀시트 래퍼) ─────────────────────────────────────────

function ModalSheet({
  visible, onClose, isDirty = false, onConfirmDismiss, title, children,
}: {
  visible: boolean;
  onClose: () => void;
  isDirty?: boolean;
  onConfirmDismiss?: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const [internalVisible, setInternalVisible] = useState(false);
  const [showDismissAlert, setShowDismissAlert] = useState(false);
  const dimAnim   = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(300)).current;

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const confirmDismissRef = useRef<() => void>(onConfirmDismiss ?? onClose);
  confirmDismissRef.current = onConfirmDismiss ?? onClose;

  const handleDismissRef = useRef<() => void>(() => {});
  handleDismissRef.current = () => {
    if (isDirtyRef.current) {
      setShowDismissAlert(true);
    } else {
      confirmDismissRef.current();
    }
  };

  const dragPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy >= 80) handleDismissRef.current();
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      dimAnim.setValue(0);
      sheetAnim.setValue(300);
      setShowDismissAlert(false);
      setInternalVisible(true);
      Animated.parallel([
        Animated.timing(dimAnim,   { toValue: 0.4, duration: 250, useNativeDriver: true }),
        Animated.spring(sheetAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }),
      ]).start();
    } else {
      setShowDismissAlert(false);
      Animated.parallel([
        Animated.timing(dimAnim,   { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
      ]).start(() => setInternalVisible(false));
    }
  }, [visible]);

  return (
    <Modal visible={internalVisible} transparent animationType="none" onRequestClose={() => handleDismissRef.current()}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: dimAnim }]}
        pointerEvents="none"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => handleDismissRef.current()} />
        <Animated.View style={{ transform: [{ translateY: sheetAnim }] }}>
          <Pressable style={ms.sheet} onPress={e => e.stopPropagation()}>
            <View style={ms.handleWrap} {...dragPan.panHandlers}>
              <View style={ms.handle} />
            </View>
            <Text style={ms.title}>{title}</Text>
            {children}
            <View style={{ position: 'absolute', bottom: -50, left: 0, right: 0, height: 50, backgroundColor: '#fff' }} pointerEvents="none" />
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* dismiss 확인 오버레이 — 별도 Modal 없이 동일 Modal 안에 렌더링 */}
      {showDismissAlert && (
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }]}
          onPress={() => setShowDismissAlert(false)}
        >
          <Pressable style={cm.card} onPress={e => e.stopPropagation()}>
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#2D1B1E', textAlign: 'center', paddingVertical: 18, paddingHorizontal: 16 }}>
              기록을 취소하시겠어요?
            </Text>
            <View style={cm.cardDivider} />
            <View style={cm.btnRow}>
              <TouchableOpacity style={[cm.btn, cm.btnLeft]} onPress={() => setShowDismissAlert(false)} activeOpacity={0.8}>
                <Text style={cm.editTxt}>계속 작성</Text>
              </TouchableOpacity>
              <TouchableOpacity style={cm.btn} onPress={() => { setShowDismissAlert(false); confirmDismissRef.current(); }} activeOpacity={0.8}>
                <Text style={cm.deleteTxt}>취소하기</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

const ms = StyleSheet.create({
  sheet:      { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 0, paddingBottom: 0, maxHeight: SH * 0.92 },
  handleWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 12 },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: '#EDD5DA' },
  title:      { fontFamily: 'Pretendard-Bold', fontSize: 17, color: '#2D1B1E', marginBottom: 18, paddingHorizontal: 20 },
});

const cm = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  card:        { backgroundColor: '#fff', borderRadius: 16, width: 220, overflow: 'hidden', paddingTop: 6 },
  cardDivider: { height: 1, backgroundColor: '#E0E0E0' },
  btnRow:      { flexDirection: 'row' },
  btn:         { flex: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnLeft:     { borderRightWidth: 1, borderRightColor: '#E0E0E0' },
  editTxt:     { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#2D1B1E' },
  deleteTxt:   { fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#FF3B30' },
});

// ─── PhotoAddModal ────────────────────────────────────────────────────────────

function PhotoAddModal({
  visible, onClose, coupleId, myUid, onSaved,
}: {
  visible: boolean; onClose: () => void; coupleId: string; myUid: string; onSaved: () => void;
}) {
  const [uri, setUri]         = useState('');
  const [caption, setCaption] = useState('');
  const [saving, setSaving]   = useState(false);

  async function handlePick() { const u = await pickImage(); if (u) setUri(u); }

  function resetAndClose() {
    setUri(''); setCaption('');
    onClose();
  }

  async function handleSave() {
    if (!uri || saving) return;
    setSaving(true);
    try {
      const imageUrl = await uploadToStorage(uri, `album/${coupleId}/${myUid}_${Date.now()}.jpg`);
      await addDoc(collection(db, 'couples', coupleId, 'album'), {
        type: 'photo', imageUrl, ...randomTape(),
        createdAt: Timestamp.now(), createdBy: myUid,
        confirmed: false,
        photo: { caption: caption.trim() },
      });
      setUri(''); setCaption('');
      onSaved(); onClose();
    } catch { Alert.alert('저장에 실패했어요.'); }
    finally { setSaving(false); }
  }

  const isDirty = !!uri || !!caption;

  return (
    <ModalSheet visible={visible} onClose={onClose} isDirty={isDirty} onConfirmDismiss={resetAndClose} title="사진 추가">
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <ImagePickArea uri={uri} onPick={handlePick} height={200} />
        <TextInput
          style={[f.input, { marginTop: 14 }]}
          placeholder="한 줄 메모 (선택)"
          placeholderTextColor="#C8B4B8"
          value={caption}
          onChangeText={setCaption}
          maxLength={80}
        />
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16, paddingTop: 8 }}>
        <TouchableOpacity style={[f.submitBtn, { marginTop: 0 }, (!uri || saving) && f.submitOff]} onPress={handleSave} disabled={!uri || saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={f.submitTxt}>등록하기</Text>}
        </TouchableOpacity>
      </View>
    </ModalSheet>
  );
}

// ─── BookAddModal ─────────────────────────────────────────────────────────────

function BookAddModal({
  visible, onClose, coupleId, myUid, onSaved,
}: {
  visible: boolean; onClose: () => void; coupleId: string; myUid: string; onSaved: () => void;
}) {
  const [uri, setUri]             = useState('');
  const [title, setTitle]         = useState('');
  const [author, setAuthor]       = useState('');
  const [isReading, setIsReading] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate]     = useState<Date | null>(null);
  const [rating, setRating]       = useState(0);
  const [review, setReview]       = useState('');
  const [saving, setSaving]       = useState(false);

  async function handlePick() { const u = await pickImage(); if (u) setUri(u); }

  function resetAndClose() {
    setUri(''); setTitle(''); setAuthor(''); setIsReading(false);
    setStartDate(null); setEndDate(null); setRating(0); setReview('');
    onClose();
  }

  async function handleSave() {
    if (!uri || !title.trim() || saving) return;
    setSaving(true);
    try {
      const imageUrl = await uploadToStorage(uri, `album/${coupleId}/${myUid}_${Date.now()}.jpg`);
      await addDoc(collection(db, 'couples', coupleId, 'album'), {
        type: 'book', imageUrl, ...randomTape(),
        createdAt: Timestamp.now(), createdBy: myUid,
        confirmed: false,
        book: {
          title: title.trim(), author: author.trim(),
          status: isReading ? 'reading' : 'done',
          review: review.trim(),
          startDate: startDate ? dateToIso(startDate) : '',
          ...(isReading ? {} : {
            endDate: endDate ? dateToIso(endDate) : '',
            rating,
          }),
        },
      });
      setUri(''); setTitle(''); setAuthor(''); setIsReading(false);
      setStartDate(null); setEndDate(null); setRating(0); setReview('');
      onSaved(); onClose();
    } catch { Alert.alert('저장에 실패했어요.'); }
    finally { setSaving(false); }
  }

  const canSave = !!uri && !!title.trim();
  const isDirty = !!uri || !!title || !!author || isReading || startDate !== null || endDate !== null || rating > 0 || !!review;

  return (
    <ModalSheet visible={visible} onClose={onClose} isDirty={isDirty} onConfirmDismiss={resetAndClose} title="책 추가">
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <ImagePickArea uri={uri} onPick={handlePick} height={110} />

        <TextInput style={[f.input, { marginTop: 14 }]} placeholder="제목 (필수)" placeholderTextColor="#C8B4B8" value={title} onChangeText={setTitle} maxLength={80} />
        <TextInput style={[f.input, { marginTop: 10 }]} placeholder="저자 (선택)" placeholderTextColor="#C8B4B8" value={author} onChangeText={setAuthor} maxLength={60} />

        {/* 읽기 상태 라디오 */}
        <View style={f.radioRow}>
          <TouchableOpacity style={f.radioItem} onPress={() => setIsReading(false)} activeOpacity={0.7}>
            <View style={[f.radioCircle, !isReading && f.radioCircleSelected]} />
            <Text style={[f.radioTxt, !isReading && f.radioTxtSelected]}>다 읽었어요</Text>
          </TouchableOpacity>
          <TouchableOpacity style={f.radioItem} onPress={() => setIsReading(true)} activeOpacity={0.7}>
            <View style={[f.radioCircle, isReading && f.radioCircleSelected]} />
            <Text style={[f.radioTxt, isReading && f.radioTxtSelected]}>읽는 중</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <DatePickerField label="시작일" value={startDate} onChange={setStartDate} />
          </View>
          {!isReading && (
            <View style={{ flex: 1 }}>
              <DatePickerField label="종료일" value={endDate} onChange={setEndDate} />
            </View>
          )}
        </View>

        {!isReading && (
          <View style={f.ratingRow}>
            <Text style={f.ratingLabel}>별점</Text>
            <StarRating value={rating} onChange={setRating} />
          </View>
        )}

        <TextInput style={[f.input, { marginTop: 10 }]} placeholder="한 줄 리뷰 (선택)" placeholderTextColor="#C8B4B8" value={review} onChangeText={setReview} maxLength={100} />
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16, paddingTop: 8 }}>
        <TouchableOpacity style={[f.submitBtn, { marginTop: 0 }, !canSave && f.submitOff]} onPress={handleSave} disabled={!canSave || saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={f.submitTxt}>등록하기</Text>}
        </TouchableOpacity>
      </View>
    </ModalSheet>
  );
}

// ─── MovieAddModal ────────────────────────────────────────────────────────────

function MovieAddModal({
  visible, onClose, coupleId, myUid, onSaved,
}: {
  visible: boolean; onClose: () => void; coupleId: string; myUid: string; onSaved: () => void;
}) {
  const [uri, setUri]                 = useState('');
  const [title, setTitle]             = useState('');
  const [isWatching, setIsWatching]   = useState(false);
  const [watchedDate, setWatchedDate] = useState<Date | null>(null);
  const [rating, setRating]           = useState(0);
  const [review, setReview]           = useState('');
  const [saving, setSaving]           = useState(false);

  async function handlePick() { const u = await pickImage(); if (u) setUri(u); }

  function resetAndClose() {
    setUri(''); setTitle(''); setIsWatching(false); setWatchedDate(null); setRating(0); setReview('');
    onClose();
  }

  async function handleSave() {
    if (!uri || !title.trim() || saving) return;
    setSaving(true);
    try {
      const imageUrl = await uploadToStorage(uri, `album/${coupleId}/${myUid}_${Date.now()}.jpg`);
      await addDoc(collection(db, 'couples', coupleId, 'album'), {
        type: 'movie', imageUrl, ...randomTape(),
        createdAt: Timestamp.now(), createdBy: myUid,
        confirmed: false,
        movie: {
          title: title.trim(),
          status: isWatching ? 'watching' : 'done',
          review: review.trim(),
          ...(isWatching ? {} : {
            watchedDate: watchedDate ? dateToIso(watchedDate) : '',
            rating,
          }),
        },
      });
      setUri(''); setTitle(''); setIsWatching(false); setWatchedDate(null); setRating(0); setReview('');
      onSaved(); onClose();
    } catch { Alert.alert('저장에 실패했어요.'); }
    finally { setSaving(false); }
  }

  const canSave = !!uri && !!title.trim();
  const isDirty = !!uri || !!title || isWatching || watchedDate !== null || rating > 0 || !!review;

  return (
    <ModalSheet visible={visible} onClose={onClose} isDirty={isDirty} onConfirmDismiss={resetAndClose} title="영화 추가">
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <ImagePickArea uri={uri} onPick={handlePick} height={130} />

        <TextInput style={[f.input, { marginTop: 14 }]} placeholder="제목 (필수)" placeholderTextColor="#C8B4B8" value={title} onChangeText={setTitle} maxLength={80} />

        {/* 시청 상태 라디오 */}
        <View style={f.radioRow}>
          <TouchableOpacity style={f.radioItem} onPress={() => setIsWatching(false)} activeOpacity={0.7}>
            <View style={[f.radioCircle, !isWatching && f.radioCircleSelected]} />
            <Text style={[f.radioTxt, !isWatching && f.radioTxtSelected]}>다 봤어요</Text>
          </TouchableOpacity>
          <TouchableOpacity style={f.radioItem} onPress={() => setIsWatching(true)} activeOpacity={0.7}>
            <View style={[f.radioCircle, isWatching && f.radioCircleSelected]} />
            <Text style={[f.radioTxt, isWatching && f.radioTxtSelected]}>보는 중</Text>
          </TouchableOpacity>
        </View>

        {!isWatching && (
          <View style={{ marginTop: 10 }}>
            <DatePickerField label="본 날짜 (선택)" value={watchedDate} onChange={setWatchedDate} />
          </View>
        )}

        {!isWatching && (
          <View style={f.ratingRow}>
            <Text style={f.ratingLabel}>별점</Text>
            <StarRating value={rating} onChange={setRating} />
          </View>
        )}

        <TextInput style={[f.input, { marginTop: 10 }]} placeholder="한 줄 리뷰 (선택)" placeholderTextColor="#C8B4B8" value={review} onChangeText={setReview} maxLength={100} />
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16, paddingTop: 8 }}>
        <TouchableOpacity style={[f.submitBtn, { marginTop: 0 }, !canSave && f.submitOff]} onPress={handleSave} disabled={!canSave || saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={f.submitTxt}>등록하기</Text>}
        </TouchableOpacity>
      </View>
    </ModalSheet>
  );
}

// ─── DetailModal ──────────────────────────────────────────────────────────────

function DetailModal({
  item, myUid, coupleId, onClose, onDeleted,
}: {
  item: AlbumItem | null; myUid: string; coupleId: string; onClose: () => void; onDeleted: () => void;
}) {
  const [internalVisible, setInternalVisible] = useState(false);
  const [internalItem, setInternalItem]       = useState<AlbumItem | null>(null);
  const dimAnim   = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    if (item) {
      setInternalItem(item);
      dimAnim.setValue(0);
      sheetAnim.setValue(300);
      setInternalVisible(true);
      Animated.parallel([
        Animated.timing(dimAnim,   { toValue: 0.6, duration: 250, useNativeDriver: true }),
        Animated.spring(sheetAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(dimAnim,   { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
      ]).start(() => { setInternalVisible(false); setInternalItem(null); });
    }
  }, [item]);

  if (!internalItem) return null;

  const isOwn = internalItem.createdBy === myUid;
  const title =
    internalItem.type === 'book'  ? internalItem.book?.title  :
    internalItem.type === 'movie' ? internalItem.movie?.title :
    undefined;

  function handleDelete() {
    Alert.alert('삭제', '이 항목을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'couples', coupleId, 'album', internalItem.id));
            onDeleted(); onClose();
          } catch { Alert.alert('삭제에 실패했어요.'); }
        },
      },
    ]);
  }

  return (
    <Modal visible={internalVisible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: dimAnim }]}
        pointerEvents="none"
      />
      <Pressable style={dm.overlay} onPress={onClose}>
        <Animated.View style={{ transform: [{ translateY: sheetAnim }], width: '100%', flexShrink: 1, paddingHorizontal: 24 }}>
          <Pressable style={dm.card} onPress={e => e.stopPropagation()}>
            {/* 이미지 */}
            <View style={dm.imageWrap}>
              <AdaptiveImage uri={internalItem.imageUrl} width={SW - 48} storedW={internalItem.width} storedH={internalItem.height} />
            </View>

            {/* 내용 */}
            <ScrollView style={dm.body} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} bounces={true} nestedScrollEnabled={true}>
              {/* 공통: 타입 뱃지 */}
              <View style={dm.typeBadge}>
                <Text style={dm.typeTxt}>
                  {internalItem.type === 'photo' ? '📷 사진' : internalItem.type === 'book' ? '📚 책' : '🎬 영화'}
                </Text>
              </View>

              {/* 제목 (책/영화) */}
              {title && <Text style={dm.titleTxt}>{title}</Text>}

              {/* 사진: 메모 */}
              {internalItem.type === 'photo' && internalItem.photo?.caption ? (
                <Text style={dm.captionTxt}>{internalItem.photo.caption}</Text>
              ) : null}

              {/* 책 */}
              {internalItem.type === 'book' && internalItem.book && (() => {
                const book = internalItem.book!;
                const isReading = book.status === 'reading';
                return (
                  <View style={{ gap: 6 }}>
                    {isReading && (
                      <View style={dm.statusBadge}>
                        <Text style={dm.statusTxt}>📖 읽는 중</Text>
                      </View>
                    )}
                    {book.author ? <Text style={dm.metaTxt}>저자 · {book.author}</Text> : null}
                    {isReading
                      ? book.startDate ? <Text style={dm.metaTxt}>시작 · {isoToDisplay(book.startDate)}</Text> : null
                      : (book.startDate || book.endDate)
                        ? <Text style={dm.metaTxt}>{isoToDisplay(book.startDate)} ~ {isoToDisplay(book.endDate)}</Text>
                        : null}
                    {!isReading && book.rating > 0 && <StarRating value={book.rating} size={18} />}
                    {book.review ? <Text style={dm.reviewTxt}>{book.review}</Text> : null}
                  </View>
                );
              })()}

              {/* 영화 */}
              {internalItem.type === 'movie' && internalItem.movie && (() => {
                const movie = internalItem.movie!;
                const isWatching = movie.status === 'watching';
                return (
                  <View style={{ gap: 6 }}>
                    {isWatching && (
                      <View style={dm.statusBadge}>
                        <Text style={dm.statusTxt}>🎬 보는 중</Text>
                      </View>
                    )}
                    {!isWatching && movie.watchedDate
                      ? <Text style={dm.metaTxt}>본 날짜 · {isoToDisplay(movie.watchedDate)}</Text>
                      : null}
                    {!isWatching && movie.rating > 0 && <StarRating value={movie.rating} size={18} />}
                    {movie.review ? <Text style={dm.reviewTxt}>{movie.review}</Text> : null}
                  </View>
                );
              })()}
            </ScrollView>

            {/* 삭제 버튼 */}
            {isOwn && (
              <TouchableOpacity style={dm.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
                <Text style={dm.deleteTxt}>삭제</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card:    { backgroundColor: '#fff', borderRadius: 24, overflow: 'hidden', width: '100%', maxHeight: SH * 0.85, flexShrink: 1 },
  imageWrap: { width: '100%', overflow: 'hidden' },
  body:    { flexShrink: 1, paddingHorizontal: 18, paddingTop: 14 },
  typeBadge:  { alignSelf: 'flex-start', backgroundColor: '#F5ECEE', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 8 },
  typeTxt:    { fontFamily: 'Pretendard-Medium', fontSize: 12, color: '#F17088' },
  titleTxt:   { fontFamily: 'Pretendard-Bold', fontSize: 18, color: '#2D1B1E', marginBottom: 6 },
  captionTxt: { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#4A3B3E', lineHeight: 20 },
  metaTxt:    { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#9B8B8E' },
  reviewTxt:  { fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#4A3B3E', lineHeight: 20, marginTop: 4 },
  deleteBtn:  { margin: 14, height: 46, borderRadius: 23, backgroundColor: '#FFF0F3', borderWidth: 1, borderColor: '#F9C0CB', alignItems: 'center', justifyContent: 'center' },
  deleteTxt:  { fontFamily: 'Pretendard-SemiBold', fontSize: 14, color: '#E05070' },
  statusBadge: { alignSelf: 'flex-start', backgroundColor: '#FFF0F3', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 2 },
  statusTxt:   { fontFamily: 'Pretendard-Medium', fontSize: 12, color: '#F17088' },
});

// ─── AlbumGridItem ────────────────────────────────────────────────────────────

function AlbumGridItem({ item, onPress }: { item: AlbumItem; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={s.gridItem}>
      {/* 테이프 */}
      <Image
        source={TAPE[item.tapeIndex % 10]}
        style={[s.tape, { transform: [{ rotate: `${item.tapeRotation}deg` }] }]}
        resizeMode="stretch"
      />
      {/* 이미지 */}
      <View style={s.gridImageWrap}>
        <AdaptiveImage uri={item.imageUrl} width={ITEM_W} storedW={item.width} storedH={item.height} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function AlbumScreen() {
  const { nickname: partnerNickname, profileImage: partnerProfileImage } = usePartnerProfile();
  const [items, setItems]     = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [myUid, setMyUid]     = useState('');
  const [coupleId, setCoupleId] = useState('');

  // 모달
  const [photoModal, setPhotoModal] = useState(false);
  const [bookModal, setBookModal]   = useState(false);
  const [movieModal, setMovieModal] = useState(false);
  const [detailItem, setDetailItem] = useState<AlbumItem | null>(null);
  const [pendingId, setPendingId]   = useState<string | null>(null);

  // FAB 애니메이션
  const [fabOpen, setFabOpen] = useState(false);
  const fabRotAnim   = useRef(new Animated.Value(0)).current;
  const dimAnim      = useRef(new Animated.Value(0)).current;
  const photoBAnim   = useRef(new Animated.Value(FAB_BOT)).current;
  const bookBAnim    = useRef(new Animated.Value(FAB_BOT)).current;
  const movieBAnim   = useRef(new Animated.Value(FAB_BOT)).current;

  const fabRotation = fabRotAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    init();
    return () => { unsubRef.current?.(); };
  }, []);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('pendingAlbumItemId').then(id => {
        if (!id) return;
        AsyncStorage.removeItem('pendingAlbumItemId');
        setPendingId(id);
      });
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      async function confirmPartnerItems() {
        const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
        const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
        if (!uid || !cid) return;
        const snap = await getDocs(
          query(
            collection(db, 'couples', cid, 'album'),
            where('confirmed', '==', false),
            where('createdBy', '!=', uid),
          ),
        );
        await Promise.all(snap.docs.map(d => updateDoc(d.ref, { confirmed: true })));
      }
      confirmPartnerItems();
    }, []),
  );

  useEffect(() => {
    if (!pendingId || items.length === 0) return;
    const target = items.find(i => i.id === pendingId);
    if (target) {
      setDetailItem(target);
      setPendingId(null);
    }
  }, [pendingId, items]);

  async function init() {
    const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
    const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
    setMyUid(uid);
    setCoupleId(cid);
    if (!cid) { setLoading(false); return; }

    const q = query(collection(db, 'couples', cid, 'album'), orderBy('createdAt', 'desc'));
    unsubRef.current = onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as AlbumItem)));
      setLoading(false);
    }, () => setLoading(false));
  }

  // ── FAB 열기/닫기 ─────────────────────────────────────────────────────────

  function openFab() {
    setFabOpen(true);
    Animated.parallel([
      Animated.timing(fabRotAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(dimAnim,    { toValue: 0.4, duration: 200, useNativeDriver: true }),
    ]).start();
    Animated.stagger(50, [
      Animated.spring(photoBAnim, { toValue: FAB_BOT + 70,  useNativeDriver: false, damping: 14 }),
      Animated.spring(bookBAnim,  { toValue: FAB_BOT + 140, useNativeDriver: false, damping: 14 }),
      Animated.spring(movieBAnim, { toValue: FAB_BOT + 210, useNativeDriver: false, damping: 14 }),
    ]).start();
  }

  function closeFab(cb?: () => void) {
    Animated.parallel([
      Animated.timing(fabRotAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(dimAnim,    { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(photoBAnim, { toValue: FAB_BOT, duration: 150, useNativeDriver: false }),
      Animated.timing(bookBAnim,  { toValue: FAB_BOT, duration: 150, useNativeDriver: false }),
      Animated.timing(movieBAnim, { toValue: FAB_BOT, duration: 150, useNativeDriver: false }),
    ]).start(() => { setFabOpen(false); cb?.(); });
  }

  function toggleFab() { fabOpen ? closeFab() : openFab(); }

  function openPhotoModal()  { closeFab(() => setPhotoModal(true)); }
  function openBookModal()   { closeFab(() => setBookModal(true)); }
  function openMovieModal()  { closeFab(() => setMovieModal(true)); }

  // ── 서브 버튼 opacity 보간 ────────────────────────────────────────────────

  const photoOpacity = photoBAnim.interpolate({ inputRange: [FAB_BOT, FAB_BOT + 70],  outputRange: [0, 1], extrapolate: 'clamp' });
  const bookOpacity  = bookBAnim.interpolate(  { inputRange: [FAB_BOT, FAB_BOT + 140], outputRange: [0, 1], extrapolate: 'clamp' });
  const movieOpacity = movieBAnim.interpolate( { inputRange: [FAB_BOT, FAB_BOT + 210], outputRange: [0, 1], extrapolate: 'clamp' });

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' }}>
        <ActivityIndicator color="#F17088" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Text style={s.headerTitle}>앨범</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          s.grid,
          items.length === 0 && { flex: 1 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {items.length === 0 ? (
          <View style={s.empty}>
            {/* <Ionicons name="images-outline" size={32} color="#C4A0A8" /> */}
            <Text style={s.emptyText}>아직 추가된 항목이 없어요</Text>
            <Text style={s.emptySubText}>사진, 책, 영화를 기록해 보세요</Text>
          </View>
        ) : (
          items.map(item => (
            <AlbumGridItem
              key={item.id}
              item={item}
              onPress={() => setDetailItem(item)}
            />
          ))
        )}
      </ScrollView>

      {/* ── 딤 배경 (FAB 열렸을 때) */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: dimAnim }]}
        pointerEvents={fabOpen ? 'auto' : 'none'}
      >
        <Pressable style={{ flex: 1 }} onPress={() => closeFab()} />
      </Animated.View>

      {/* ── FAB 서브 버튼: 사진 */}
      <Animated.View
        style={[s.subFabWrap, { bottom: photoBAnim, opacity: photoOpacity }]}
        pointerEvents={fabOpen ? 'auto' : 'none'}
      >
        <Text style={s.subFabLabel}>사진</Text>
        <TouchableOpacity style={s.subFab} onPress={openPhotoModal} activeOpacity={0.85}>
          <Ionicons name="image-outline" size={22} color="#F17088" />
        </TouchableOpacity>
      </Animated.View>

      {/* ── FAB 서브 버튼: 책 */}
      <Animated.View
        style={[s.subFabWrap, { bottom: bookBAnim, opacity: bookOpacity }]}
        pointerEvents={fabOpen ? 'auto' : 'none'}
      >
        <Text style={s.subFabLabel}>책</Text>
        <TouchableOpacity style={s.subFab} onPress={openBookModal} activeOpacity={0.85}>
          <Ionicons name="book-outline" size={22} color="#F17088" />
        </TouchableOpacity>
      </Animated.View>

      {/* ── FAB 서브 버튼: 영화 */}
      <Animated.View
        style={[s.subFabWrap, { bottom: movieBAnim, opacity: movieOpacity }]}
        pointerEvents={fabOpen ? 'auto' : 'none'}
      >
        <Text style={s.subFabLabel}>영화</Text>
        <TouchableOpacity style={s.subFab} onPress={openMovieModal} activeOpacity={0.85}>
          <Ionicons name="film-outline" size={22} color="#F17088" />
        </TouchableOpacity>
      </Animated.View>

      {/* ── 메인 FAB */}
      <TouchableOpacity style={s.fab} onPress={toggleFab} activeOpacity={0.9}>
        <Animated.View style={{ transform: [{ rotate: fabRotation }] }}>
          <Ionicons name="add" size={28} color="#fff" />
        </Animated.View>
      </TouchableOpacity>

      {/* ── 모달들 */}
      <PhotoAddModal
        visible={photoModal}
        onClose={() => setPhotoModal(false)}
        coupleId={coupleId}
        myUid={myUid}
        onSaved={() => {}}
      />
      <BookAddModal
        visible={bookModal}
        onClose={() => setBookModal(false)}
        coupleId={coupleId}
        myUid={myUid}
        onSaved={() => {}}
      />
      <MovieAddModal
        visible={movieModal}
        onClose={() => setMovieModal(false)}
        coupleId={coupleId}
        myUid={myUid}
        onSaved={() => {}}
      />
      <DetailModal
        item={detailItem}
        myUid={myUid}
        coupleId={coupleId}
        onClose={() => setDetailItem(null)}
        onDeleted={() => setDetailItem(null)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderColor: '#F0EAEB',
    backgroundColor: '#FAFAFA',
  },
  headerTitle: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 20,
    color: '#2D1B1E',
  },

  // 그리드
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: PAD_H,
    paddingTop: 20,
    paddingBottom: 130,
    gap: ITEM_GAP,
  },

  // 그리드 아이템
  gridItem: {
    width: ITEM_W,
    paddingTop: 14,
  },
  gridImageWrap: {
    borderWidth: 1,
    borderColor: '#F9F9F9',
    overflow: 'hidden',
  },
  tape: {
    position: 'absolute',
    top: 2,
    left: (ITEM_W - 60) / 2,
    width: 60,
    height: 22,
    zIndex: 1,
  },

  // 빈 상태
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2D1B1E',
  },
  emptySubText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#B0A0A4',
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    bottom: FAB_BOT,
    width: FAB_W,
    height: FAB_W,
    borderRadius: FAB_W / 2,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F17088',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 20,
  },

  // 서브 FAB
  subFabWrap: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 19,
  },
  subFab: {
    width: FAB_W,
    height: FAB_W,
    borderRadius: FAB_W / 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  subFabLabel: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 13,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

// ─── 공통 폼 스타일 ────────────────────────────────────────────────────────────

const f = StyleSheet.create({
  input: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5ECEE',
    paddingHorizontal: 18,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    marginBottom: 2,
  },
  ratingLabel: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#9B8B8E',
    width: 30,
  },
  submitBtn: {
    marginTop: 20,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitOff: { backgroundColor: '#DDACB5' },
  submitTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#fff',
  },
  // ── 라디오 버튼
  radioRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  radioCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#C8B4B8',
  },
  radioCircleSelected: {
    backgroundColor: '#FF6B8A',
    borderColor: '#FF6B8A',
  },
  radioTxt: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#B0A0A4',
  },
  radioTxtSelected: {
    fontFamily: 'Pretendard-SemiBold',
    color: '#FF6B8A',
  },
});
