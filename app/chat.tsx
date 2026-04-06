import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref as sRef, uploadBytes } from 'firebase/storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePartnerProfile } from '../contexts/PartnerProfileContext';
import { useProfile } from '../contexts/ProfileContext';
import { auth, db } from '../firebaseConfig';

const { width: SW } = Dimensions.get('window');

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  text: string;
  senderId: string;
  createdAt: Timestamp | null;
  read: boolean;
  imageUrl?: string;    // legacy single
  imageUrls?: string[]; // multi-image
  reactions?: Record<string, string>; // uid → 이모지
  replyTo?: {
    messageId: string;
    text: string;
    senderId: string;
  };
}

type ChatItem =
  | { type: 'message'; data: Message; showAvatar: boolean; isFirst: boolean; isLast: boolean; isSingle: boolean }
  | { type: 'separator'; label: string };

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(ts: Timestamp): string {
  const d    = ts.toDate();
  const h    = d.getHours();
  const min  = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${h % 12 || 12}:${min}`;
}

function dateSepLabel(dateStr: string): string {
  const today = toDateStr(new Date());
  const yest  = toDateStr(new Date(Date.now() - 86400000));
  if (dateStr === today) return '오늘';
  if (dateStr === yest)  return '어제';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

function sameGroup(a: Message, b: Message): boolean {
  if (a.senderId !== b.senderId) return false;
  if (!a.createdAt || !b.createdAt) return false;
  const da = a.createdAt.toDate();
  const db = b.createdAt.toDate();
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth()    === db.getMonth()    &&
    da.getDate()     === db.getDate()     &&
    da.getHours()    === db.getHours()    &&
    da.getMinutes()  === db.getMinutes()
  );
}

function buildChatItems(messages: Message[], myUid: string): ChatItem[] {
  const items: ChatItem[] = [];
  let lastDate = '';

  const validMessages = messages.filter(m => m.createdAt);

  for (let i = 0; i < validMessages.length; i++) {
    const msg  = validMessages[i];
    const prev = validMessages[i - 1];
    const next = validMessages[i + 1];

    const dateStr = toDateStr(msg.createdAt!.toDate());
    if (dateStr !== lastDate) {
      items.push({ type: 'separator', label: dateSepLabel(dateStr) });
      lastDate = dateStr;
    }

    const inGroupWithPrev = prev ? sameGroup(prev, msg) : false;
    const inGroupWithNext = next ? sameGroup(msg, next) : false;

    const isFirst  = !inGroupWithPrev;
    const isLast   = !inGroupWithNext;
    const isSingle = isFirst && isLast;
    const showAvatar = isFirst;

    items.push({ type: 'message', data: msg, showAvatar, isFirst, isLast, isSingle });
  }
  return items;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const HEADER_H = 56;
const AVATAR_W = 32;
const IMG_SINGLE = 216;
const IMG_CELL   = 106;
const IMG_GAP    = 2;

// ─── 이미지 스켈레톤 ──────────────────────────────────────────────────────────

function ChatImage({ uri, style }: { uri: string; style: object }) {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <View style={[style, { backgroundColor: '#E8E8E8' }]}>
      <Image
        source={{ uri }}
        style={[style, { position: 'absolute', top: 0, left: 0 }]}
        contentFit="cover"
        cachePolicy="memory-disk"
        onLoad={() => Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()}
        transition={0}
      />
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(new Animated.Value(1), opacity) }]}
        pointerEvents="none"
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#E8E8E8' }]} />
      </Animated.View>
    </View>
  );
}

// ─── 이미지 그리드 ────────────────────────────────────────────────────────────

function ImageGrid({ urls }: { urls: string[] }) {
  if (urls.length === 1) {
    return <ChatImage uri={urls[0]} style={{ width: IMG_SINGLE, height: IMG_SINGLE }} />;
  }
  if (urls.length === 2) {
    return (
      <View style={{ flexDirection: 'row', gap: IMG_GAP }}>
        {urls.map((u, i) => <ChatImage key={i} uri={u} style={{ width: IMG_CELL, height: IMG_CELL }} />)}
      </View>
    );
  }
  if (urls.length === 3) {
    return (
      <View style={{ gap: IMG_GAP }}>
        <View style={{ flexDirection: 'row', gap: IMG_GAP }}>
          <ChatImage uri={urls[0]} style={{ width: IMG_CELL, height: IMG_CELL }} />
          <ChatImage uri={urls[1]} style={{ width: IMG_CELL, height: IMG_CELL }} />
        </View>
        <ChatImage uri={urls[2]} style={{ width: IMG_CELL * 2 + IMG_GAP, height: IMG_CELL }} />
      </View>
    );
  }
  // 4+: 2열 그리드
  const rows: string[][] = [];
  for (let i = 0; i < urls.length; i += 2) rows.push(urls.slice(i, i + 2));
  return (
    <View style={{ gap: IMG_GAP }}>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: IMG_GAP }}>
          {row.map((u, ci) => <ChatImage key={ci} uri={u} style={{ width: IMG_CELL, height: IMG_CELL }} />)}
        </View>
      ))}
    </View>
  );
}

// ─── 말풍선 radius 헬퍼 ───────────────────────────────────────────────────────

function getBubbleRadius(isMe: boolean, isSingle: boolean, isFirst: boolean, isLast: boolean) {
  const base = 18;
  const small = 4;

  if (isSingle) {
    return {
      borderTopLeftRadius: base,
      borderTopRightRadius: base,
      borderBottomLeftRadius: base,
      borderBottomRightRadius: base,
    };
  }

  if (isMe) {
    return {
      borderTopLeftRadius: base,
      borderTopRightRadius: isFirst ? base : small,
      borderBottomLeftRadius: base,
      borderBottomRightRadius: isLast ? base : small,
    };
  } else {
    return {
      borderTopLeftRadius: isFirst ? base : small,
      borderTopRightRadius: base,
      borderBottomLeftRadius: isLast ? base : small,
      borderBottomRightRadius: base,
    };
  }
}

// ─── MessageRow ───────────────────────────────────────────────────────────────

function MessageRow({
  item, myUid, partnerNick, partnerAvatar, myNick, myAvatar,
  lastReadId, chatItems, flatListRef, setMenuMsg, setReplyTo, setProfileModal,
  highlightId, setHighlightId,
}: {
  item: Extract<ChatItem, { type: 'message' }>;
  myUid: string;
  partnerNick: string;
  partnerAvatar: string;
  myNick: string;
  myAvatar: string;
  lastReadId: string;
  chatItems: ChatItem[];
  flatListRef: React.RefObject<FlatList>;
  setMenuMsg: (m: Message | null) => void;
  setReplyTo: (m: Message | null) => void;
  setProfileModal: (m: { visible: boolean; name: string; image: string }) => void;
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
}) {
  const { data: msg, showAvatar, isFirst, isLast, isSingle } = item;
  const isMe    = msg.senderId === myUid;
  const radiusStyle = getBubbleRadius(isMe, isSingle, isFirst, isLast);
  const time    = msg.createdAt ? formatTime(msg.createdAt) : '';
  const allUrls = msg.imageUrls?.length ? msg.imageUrls : msg.imageUrl ? [msg.imageUrl] : [];
  const hasImg  = allUrls.length > 0;
  const hasTxt  = !!msg.text;
  const imgOnly = hasImg && !hasTxt;

  const highlightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (highlightId === msg.id) {
      highlightAnim.setValue(0);
      Animated.sequence([
        Animated.timing(highlightAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
        Animated.timing(highlightAnim, { toValue: 0, duration: 800, useNativeDriver: false }),
      ]).start();
    }
  }, [highlightId]);

  const highlightBg = highlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isMe ? ['#F2F2F2', '#FFE8ED'] : ['#1D1D1D', '#3A3A6A'],
  });

  const scrollToReply = () => {
    if (!msg.replyTo) return;
    const idx = chatItems.findIndex(i => i.type === 'message' && i.data.id === msg.replyTo!.messageId);
    if (idx >= 0) {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
      setTimeout(() => {
        setHighlightId(msg.replyTo!.messageId);
        setTimeout(() => setHighlightId(null), 1200);
      }, 400);
    }
  };

  return (
    <View style={{ marginBottom: isLast || isSingle ? 8 : 2 }}>
      {isMe ? (
        <View style={s.rowRight}>
          <View style={s.metaRight}>
            {isLast && msg.id === lastReadId && <Text style={s.readTxt}>읽음</Text>}
            {isLast && <Text style={s.timeTxt}>{time}</Text>}
          </View>
          <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
            {msg.replyTo && (
              <TouchableOpacity
                style={[s.replyPreviewBox, { backgroundColor: '#DCDCDC' }]}
                onPress={scrollToReply}
                activeOpacity={0.7}
                delayPressIn={150}
              >
                <View style={s.replyBar} />
                <Text style={[s.replyPreviewTxt, { color: 'rgba(0,0,0,0.5)' }]} numberOfLines={2}>
                  {msg.replyTo.text || '📷 사진'}
                </Text>
              </TouchableOpacity>
            )}
            <Animated.View style={[s.bubble, radiusStyle, { backgroundColor: highlightBg }]}>
              <TouchableOpacity
                onLongPress={() => setMenuMsg(msg)}
                delayLongPress={350}
                activeOpacity={0.85}
                style={[s.bubbleMe, imgOnly && s.bubbleImgOnly, { backgroundColor: 'transparent' }]}
              >
                {hasImg && <ImageGrid urls={allUrls} />}
                {hasTxt && <Text style={s.bubbleMeTxt}>{msg.text}</Text>}
              </TouchableOpacity>
            </Animated.View>
            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
              <View style={[s.reactionRow, { justifyContent: 'flex-end' }]}>
                {Object.values(msg.reactions).map((emoji, i) => (
                  <Text key={i} style={s.reactionEmoji}>{emoji}</Text>
                ))}
              </View>
            )}
          </View>
          {showAvatar ? (
            <TouchableOpacity
              onPress={() => setProfileModal({ visible: true, name: myNick, image: myAvatar })}
              activeOpacity={0.8}
            >
              <Image
                source={myAvatar ? { uri: myAvatar } : require('../assets/images/profile-default.png')}
                style={s.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            </TouchableOpacity>
          ) : (
            <View style={s.avatarSpacer} />
          )}
        </View>
      ) : (
        <View style={s.rowLeft}>
          {showAvatar ? (
            <TouchableOpacity
              onPress={() => setProfileModal({ visible: true, name: partnerNick, image: partnerAvatar })}
              activeOpacity={0.8}
            >
              <Image
                source={partnerAvatar ? { uri: partnerAvatar } : require('../assets/images/profile-default.png')}
                style={s.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            </TouchableOpacity>
          ) : (
            <View style={s.avatarSpacer} />
          )}
          <View style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
            {msg.replyTo && (
              <TouchableOpacity
                style={[s.replyPreviewBox, { backgroundColor: '#3A3A3A' }]}
                onPress={scrollToReply}
                activeOpacity={0.7}
                delayPressIn={150}
              >
                <View style={s.replyBar} />
                <Text style={[s.replyPreviewTxt, { color: 'rgba(255,255,255,0.7)' }]} numberOfLines={2}>
                  {msg.replyTo.text || '📷 사진'}
                </Text>
              </TouchableOpacity>
            )}
            <Animated.View style={[s.bubble, radiusStyle, { backgroundColor: highlightBg }]}>
              <TouchableOpacity
                onLongPress={() => setMenuMsg(msg)}
                delayLongPress={350}
                activeOpacity={0.85}
                style={[s.bubblePartner, imgOnly && s.bubbleImgOnly, { backgroundColor: 'transparent' }]}
              >
                {hasImg && <ImageGrid urls={allUrls} />}
                {hasTxt && <Text style={s.bubblePartnerTxt}>{msg.text}</Text>}
              </TouchableOpacity>
            </Animated.View>
            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
              <View style={s.reactionRow}>
                {Object.values(msg.reactions).map((emoji, i) => (
                  <Text key={i} style={s.reactionEmoji}>{emoji}</Text>
                ))}
              </View>
            )}
          </View>
          {isLast && <Text style={s.timeLeft}>{time}</Text>}
        </View>
      )}
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const insets = useSafeAreaInsets();

  const [loading, setLoading]           = useState(true);
  const [myUid, setMyUid]               = useState('');
  const { nickname: myNick, profileImage: myAvatar, isReady: profileReady } = useProfile();
  const [coupleId, setCoupleId]         = useState('');
  const { nickname: partnerNick, profileImage: partnerAvatar, isReady: partnerReady } = usePartnerProfile();
  const [messages, setMessages]         = useState<Message[]>([]);
  const [allMessageIds, setAllMessageIds] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [inputText, setInputText]       = useState('');
  const [sending, setSending]           = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [showNewMsg, setShowNewMsg]     = useState(false);
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [pendingImages, setPendingImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [profileModal, setProfileModal] = useState<{ visible: boolean; name: string; image: string }>({
    visible: false, name: '', image: '',
  });
  const [menuMsg, setMenuMsg] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const flatListRef       = useRef<FlatList>(null);
  const isNearBottomRef   = useRef(true);
  const isLoadingMoreRef  = useRef(false);
  const lastVisibleDocRef = useRef<any>(null);
  const unsubscribeRef = useRef<() => void>();
  const prevMessagesLengthRef = useRef(0);

  // ── 키보드 상태 ────────────────────────────────────────────────────────────

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvent, () => setKeyboardShown(true));
    const h = Keyboard.addListener(hideEvent, () => setKeyboardShown(false));
    return () => { s.remove(); h.remove(); };
  }, []);

  // ── 초기 로드 ──────────────────────────────────────────────────────────────

  useEffect(() => { init(); }, []);

  async function init() {
    try {
      let uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      const cid = (await AsyncStorage.getItem('coupleId')) ?? '';

      // uid가 없으면 재인증 필요
      if (!uid && auth.currentUser) {
        uid = auth.currentUser.uid;
        await AsyncStorage.setItem('userUid', uid);
      }

      setMyUid(uid);
      setCoupleId(cid);
      if (!uid || !cid) return;

    } catch (e) {
      console.error('chat init error:', e);
    } finally {
      setLoading(false);
    }
  }

  // ── 메시지 실시간 리스너 ────────────────────────────────────────────────────

  useEffect(() => {
    if (!coupleId) return;

    const startTime = Date.now();
    console.log('📥 Loading messages START');

    const messagesRef = collection(db, 'couples', coupleId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(50));

    const unsubscribe = onSnapshot(q, (snap) => {
      const elapsed = Date.now() - startTime;
      console.log(`📊 Received ${snap.docs.length} messages in ${elapsed}ms`);

      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Message))
        .reverse();

      setMessages(data);

      // 가장 오래된 doc 저장 (desc 정렬이라 마지막이 가장 오래된 것)
      if (snap.docs.length > 0) {
        lastVisibleDocRef.current = snap.docs[snap.docs.length - 1];
      }

      // 50개 미만이면 더 이상 로드할 메시지가 없음
      if (snap.docs.length < 50) {
        setHasMore(false);
      }
    });

    return () => unsubscribe();
  }, [coupleId]);

  // ── 읽음 처리 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!coupleId || !myUid || messages.length === 0) return;
    const unread = messages.filter(m => m.senderId !== myUid && !m.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach(m =>
      batch.update(doc(db, 'couples', coupleId, 'messages', m.id), { read: true })
    );
    batch.commit().catch(console.error);
  }, [messages, coupleId, myUid]);

  // ── 새 메시지 자동 스크롤 (이전 메시지 길이 추적) ──────────────────────────

  useEffect(() => {
    if (messages.length === 0) return;
    if (messages.length > prevMessagesLengthRef.current) {
      if (isNearBottomRef.current) {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length]);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    isNearBottomRef.current = contentOffset.y < 100;
    if (isNearBottomRef.current && showNewMsg) setShowNewMsg(false);

    // inverted: 상단(오래된 메시지) = contentOffset.y가 큰 쪽
    if (contentOffset.y > contentSize.height - layoutMeasurement.height - 50 && !isLoadingMoreRef.current && hasMore) {
      handleLoadMore();
    }
  }

  async function handleLoadMore() {
    if (loadingMore || !hasMore || !coupleId || !lastVisibleDocRef.current) return;

    setLoadingMore(true);
    isLoadingMoreRef.current = true;
    try {
      const q = query(
        collection(db, 'couples', coupleId, 'messages'),
        orderBy('createdAt', 'desc'),
        startAfter(lastVisibleDocRef.current),
        limit(50)
      );
      const snap = await getDocs(q);
      if (snap.docs.length === 0) {
        setHasMore(false);
        return;
      }

      const older = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)).reverse();
      lastVisibleDocRef.current = snap.docs[snap.docs.length - 1];

      if (snap.docs.length < 50) setHasMore(false);

      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const deduped = older.filter(m => !existingIds.has(m.id));
        return [...deduped, ...prev];
      });
    } catch (e) {
      console.error('load more error:', e);
    } finally {
      setLoadingMore(false);
      isLoadingMoreRef.current = false;
    }
  }

  // ── 메시지 전송 ────────────────────────────────────────────────────────────

  async function handleReaction(msg: Message, emoji: string) {
    setMenuMsg(null);
    const uid = auth.currentUser?.uid ?? myUid;
    const current = msg.reactions?.[uid];
    const newReactions = { ...(msg.reactions ?? {}) };
    if (current === emoji) {
      delete newReactions[uid];
    } else {
      newReactions[uid] = emoji;
    }
    try {
      await updateDoc(doc(db, 'couples', coupleId, 'messages', msg.id), {
        reactions: newReactions,
      });
    } catch { Alert.alert('리액션 실패했어요.'); }
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    setInputText('');
    const currentReplyTo = replyTo;
    setReplyTo(null);
    try {
      const uid     = auth.currentUser?.uid ?? myUid;
      const dateStr = toKey(new Date());
      const payload: Record<string, any> = {
        text, senderId: uid, createdAt: Timestamp.now(), read: false,
      };
      if (currentReplyTo) {
        payload.replyTo = {
          messageId: currentReplyTo.id,
          text: currentReplyTo.text || '📷 사진',
          senderId: currentReplyTo.senderId,
        };
      }
      await addDoc(collection(db, 'couples', coupleId, 'messages'), payload);
      await setDoc(
        doc(db, 'couples', coupleId, 'daily', dateStr),
        { count: increment(1) }, { merge: true },
      );
    } catch { Alert.alert('전송에 실패했어요.'); }
    finally { setSending(false); }
  }

  // ── 사진 선택 ──────────────────────────────────────────────────────────────

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('갤러리 접근 권한이 필요해요.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets.length) return;
    setPendingImages(result.assets);
  }

  // ── 사진 전송 ──────────────────────────────────────────────────────────────

  async function handleSendImages() {
    if (!pendingImages.length || uploading) return;
    setUploading(true);
    try {
      const storage  = getStorage(auth.app);
      const uid      = auth.currentUser?.uid ?? myUid;
      const dateStr  = toKey(new Date());
      const imageUrls = await Promise.all(
        pendingImages.map(async (asset) => {
          let blob: Blob;
          try {
            const response = await fetch(asset.uri);
            if (!response.ok) throw new Error('fetch failed');
            blob = await response.blob();
          } catch {
            throw new Error('이미지를 불러오는데 실패했어요.');
          }
          const ref  = sRef(storage, `chats/${coupleId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
          await uploadBytes(ref, blob);
          return getDownloadURL(ref);
        })
      );
      await addDoc(collection(db, 'couples', coupleId, 'messages'), {
        text: '', senderId: uid, createdAt: Timestamp.now(), read: false, imageUrls,
      });
      await setDoc(
        doc(db, 'couples', coupleId, 'daily', dateStr),
        { count: increment(1) }, { merge: true },
      );
      setPendingImages([]);
    } catch { Alert.alert('사진 전송에 실패했어요.'); }
    finally { setUploading(false); }
  }

  // ── 더보기 액션시트 ────────────────────────────────────────────────────────

  function handleMoreActions() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['사진첩', '검색', '대화 설정', '취소'],
          cancelButtonIndex: 3,
          disabledButtonIndices: [1, 2],
        },
        (idx) => { if (idx === 0) handlePickImage(); },
      );
    } else {
      Alert.alert('더보기', undefined, [
        { text: '사진첩', onPress: handlePickImage },
        { text: '검색 (추후 공개)' },
        { text: '대화 설정 (추후 공개)' },
        { text: '취소', style: 'cancel' },
      ]);
    }
  }

  // ── 빌드 ───────────────────────────────────────────────────────────────────

  const chatItems = useMemo(() => buildChatItems(messages, myUid), [messages, myUid]);

  const lastReadId = useMemo(() => {
    const mine = messages.filter(m => m.senderId === myUid && m.read);
    return mine.length > 0 ? mine[mine.length - 1].id : '';
  }, [messages, myUid]);

  // ── 렌더 ───────────────────────────────────────────────────────────────────

  if (loading || !profileReady || !partnerReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator color="#F17088" />
      </View>
    );
  }

  const inputBottom = keyboardShown ? 10 : Math.max(insets.bottom, 10);

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <View style={[s.screen, { paddingTop: insets.top }]}>

      {/* ── 헤더 ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBtn} onPress={() => router.back()} hitSlop={8}>
          <Text style={s.backArrow}>‹</Text>
        </TouchableOpacity>
        <Image
          source={require('../assets/images/logo.png')}
          style={s.headerTitle}
          contentFit="contain"
        />
        <TouchableOpacity style={s.headerBtn} onPress={handleMoreActions} hitSlop={8}>
          <Text style={s.headerMore}>⋯</Text>
        </TouchableOpacity>
      </View>

      {/* ── 메시지 + 입력창 ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* 빈 상태 */}
        {messages.length === 0 ? (
          <Pressable style={s.emptyWrap} onPress={Keyboard.dismiss}>
            <Image source={require('../assets/images/icon-chat.png')} style={{ width: 48, height: 48, marginBottom: 12 }} contentFit="contain" />
            <Text style={s.emptyTxt}>{'아직 대화가 없어요.\n먼저 말을 걸어 봐요!'}</Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }}>
              <FlatList
                ref={flatListRef}
                data={[...chatItems].reverse()}
                inverted={true}
                keyExtractor={(item) =>
                  item.type === 'separator' ? `sep-${item.label}` : item.data.id
                }
                contentContainerStyle={s.listContent}
                scrollEventThrottle={16}
                onScroll={handleScroll}
                keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
                initialNumToRender={20}
                maxToRenderPerBatch={10}
                windowSize={10}
                removeClippedSubviews={true}
                scrollEnabled={true}
                nestedScrollEnabled={true}
                ListFooterComponent={loadingMore ? <ActivityIndicator color="#F17088" style={{ paddingVertical: 12 }} /> : null}
                renderItem={({ item }) => {
                  if (item.type === 'separator') {
                    return (
                      <View style={s.dateSep}>
                        <View style={s.dateSepLine} />
                        <Text style={s.dateSepTxt}>{item.label}</Text>
                        <View style={s.dateSepLine} />
                      </View>
                    );
                  }
                  return (
                    <MessageRow
                      item={item}
                      myUid={myUid}
                      partnerNick={partnerNick}
                      partnerAvatar={partnerAvatar}
                      myNick={myNick}
                      myAvatar={myAvatar}
                      lastReadId={lastReadId}
                      chatItems={chatItems}
                      flatListRef={flatListRef}
                      setMenuMsg={setMenuMsg}
                      setReplyTo={setReplyTo}
                      setProfileModal={setProfileModal}
                      highlightId={highlightId}
                      setHighlightId={setHighlightId}
                    />
                  );
                }}
              />

              {/* 복사 토스트 */}
              {copyToast && (
                <View style={s.toast}>
                  <Text style={s.toastTxt}>복사됐어요</Text>
                </View>
              )}

              {/* 새 메시지 버튼 (초기 진입 안정화 후 다시 추가)
              {showNewMsg && (
                <TouchableOpacity
                  style={s.newMsgBtn}
                  onPress={() => { flatListRef.current?.scrollToEnd({ animated: true }); setShowNewMsg(false); }}
                >
                  <Text style={s.newMsgTxt}>새 메시지가 있어요 👇</Text>
                </TouchableOpacity>
              )}
              */}
          </View>
        )}

        {/* ── 사진 미리보기 ── */}
        {pendingImages.length > 0 && (
          <View style={s.previewBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.previewScroll}
            >
              {pendingImages.map((asset, i) => (
                <View key={i} style={s.previewThumb}>
                  <Image source={{ uri: asset.uri }} style={{ width: 64, height: 64 }} contentFit="cover" />
                  <TouchableOpacity
                    style={s.previewRemove}
                    onPress={() => setPendingImages(imgs => imgs.filter((_, j) => j !== i))}
                  >
                    <Text style={{ color: '#fff', fontSize: 14, lineHeight: 18 }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <View style={s.previewActions}>
              <TouchableOpacity onPress={() => setPendingImages([])} style={s.previewCancelBtn}>
                <Text style={s.previewCancelTxt}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.previewSendBtn}
                onPress={handleSendImages}
                disabled={uploading}
              >
                {uploading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.previewSendTxt}>전송</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── 답장 배너 ── */}
        {replyTo && (
          <View style={s.replyBanner}>
            <View style={s.replyBannerBar} />
            <View style={{ flex: 1 }}>
              <Text style={s.replyBannerName}>
                {replyTo.senderId === myUid ? '나' : partnerNick}에게 답장
              </Text>
              <Text style={s.replyBannerText} numberOfLines={1}>
                {replyTo.text || '📷 사진'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
              <Text style={{ fontSize: 18, color: '#9B8B8E' }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 입력창 ── */}
        <View style={[s.inputBar, { paddingBottom: inputBottom }]}>
          <TouchableOpacity
            style={s.photoBtn}
            onPress={handlePickImage}
            hitSlop={6}
          >
            <Ionicons name="image-outline" size={24} color="#9B8B8E" />
          </TouchableOpacity>

          <TextInput
            style={s.textInput}
            placeholder="메시지를 입력해 주세요"
            placeholderTextColor="#C4A0A8"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
          />

          {!!inputText.trim() && (
            <TouchableOpacity
              style={s.sendBtn}
              onPress={handleSend}
              disabled={sending}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="arrow-up" size={18} color="#fff" />}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* ── 롱프레스 메뉴 모달 ── */}
      <Modal
        visible={!!menuMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuMsg(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          onPress={() => setMenuMsg(null)}
        >
          <Pressable style={s.menuSheet} onPress={e => e.stopPropagation()}>
            <View style={s.emojiRow}>
              {['❤️', '😂', '😮', '😢', '👍', '🔥'].map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={s.emojiBtn}
                  onPress={() => menuMsg && handleReaction(menuMsg, emoji)}
                >
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.menuDivider} />
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setReplyTo(menuMsg); setMenuMsg(null); }}
            >
              <Text style={s.menuItemTxt}>↩️  답장하기</Text>
            </TouchableOpacity>
            <View style={s.menuDivider} />
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => {
                if (menuMsg?.text) {
                  Clipboard.setStringAsync(menuMsg.text);
                  setCopyToast(true);
                  setTimeout(() => setCopyToast(false), 1500);
                }
                setMenuMsg(null);
              }}
            >
              <Text style={s.menuItemTxt}>📋  복사하기</Text>
            </TouchableOpacity>
            <View style={s.menuDivider} />
            <TouchableOpacity
              style={[s.menuItem, { paddingBottom: 28 }]}
              onPress={() => setMenuMsg(null)}
            >
              <Text style={[s.menuItemTxt, { color: '#9B8B8E' }]}>취소</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 프로필 모달 ── */}
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
            <Image
              source={profileModal.image
                ? { uri: profileModal.image }
                : require('../assets/images/profile-default.png')}
              style={s.profileBigImg}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <Text style={s.profileBigName}>{profileModal.name || '?'}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
    </TouchableWithoutFeedback>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },

  // 헤더
  header: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#F0EEEC',
    width: '100%',
  },
  headerBtn: {
    width: 48, height: HEADER_H,
    alignItems: 'center', justifyContent: 'center',
  },
  backArrow: { fontSize: 36, color: '#2D1B1E', lineHeight: 44, marginTop: -2 },
  headerTitle: {
    flex: 1,
    height: 40,
    alignSelf: 'center',
  },
  headerMore: { fontSize: 22, color: '#9B8B8E', letterSpacing: 1 },

  // 빈 상태
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: {
    fontFamily: 'Pretendard-Regular', fontSize: 15,
    color: '#9B8B8E', textAlign: 'center', lineHeight: 24,
  },

  // 메시지 목록
  listContent: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 12 },

  // 날짜 구분선
  dateSep: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 },
  dateSepLine: { flex: 1, height: 1, backgroundColor: '#F0EEEC' },
  dateSepTxt: { fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#C4A0A8' },

  // 아바타 공통
  avatar: {
    width: AVATAR_W, height: AVATAR_W,
    borderRadius: AVATAR_W / 2,
    backgroundColor: '#FAD0D8',
    overflow: 'hidden',
  },
  avatarSpacer: { width: AVATAR_W },

  // 상대방 메시지 (왼쪽)
  rowLeft: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  timeLeft: {
    fontFamily: 'Pretendard-Regular', fontSize: 10,
    color: '#C4A0A8', alignSelf: 'flex-end', paddingBottom: 2,
  },

  // 내 메시지 (오른쪽)
  rowRight: {
    flexDirection: 'row', justifyContent: 'flex-end',
    alignItems: 'center', gap: 6,
    width: '100%',
  },
  metaRight: {
    alignItems: 'flex-end', paddingBottom: 2, gap: 2,
  },
  readTxt: { fontFamily: 'Pretendard-Regular', fontSize: 10, color: '#F17088' },
  timeTxt: { fontFamily: 'Pretendard-Regular', fontSize: 10, color: '#C4A0A8' },

  // 말풍선 공통
  bubble: { maxWidth: SW * 0.7, overflow: 'hidden' },
  bubbleMe: {
    backgroundColor: '#F2F2F2',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  bubblePartner: {
    backgroundColor: '#1D1D1D',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleImgOnly: { paddingHorizontal: 0, paddingVertical: 0 },
  bubbleMeTxt: {
    fontFamily: 'Pretendard-Regular', fontSize: 15,
    color: '#1C1916', lineHeight: 22,
  },
  bubblePartnerTxt: {
    fontFamily: 'Pretendard-Regular', fontSize: 15,
    color: '#fff', lineHeight: 22,
  },

  // 새 메시지 버튼
  newMsgBtn: {
    position: 'absolute', bottom: 12, alignSelf: 'center',
    backgroundColor: '#1D1D1D',
    paddingHorizontal: 18, paddingVertical: 9,
    borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },
  newMsgTxt: { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#fff' },

  // 사진 미리보기
  previewBar: {
    borderTopWidth: 1, borderColor: '#F0EEEC',
    backgroundColor: '#FAFAFA',
    paddingVertical: 10,
  },
  previewScroll: { paddingHorizontal: 12, gap: 8 },
  previewThumb: {
    width: 64, height: 64, borderRadius: 8,
    overflow: 'hidden', position: 'relative',
  },
  previewRemove: {
    position: 'absolute', top: 2, right: 2,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewActions: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: 12, paddingTop: 8, gap: 8,
  },
  previewCancelBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: '#E0D6D8',
  },
  previewCancelTxt: { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#9B8B8E' },
  previewSendBtn: {
    paddingHorizontal: 20, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#1D1D1D',
  },
  previewSendTxt: { fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#fff' },

  // 입력창
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderColor: '#F0EEEC',
    gap: 8,
  },
  photoBtn: {
    width: 36, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  textInput: {
    flex: 1, maxHeight: 5 * 22,
    paddingHorizontal: 16, paddingVertical: 11,
    backgroundColor: '#F2F2F2', borderRadius: 20,
    fontFamily: 'Pretendard-Regular', fontSize: 15,
    color: '#1C1916', lineHeight: 22,
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1D1D1D',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },

  // 답장 미리보기 (말풍선 위)
  replyPreviewBox: {
    flexDirection: 'row', alignItems: 'stretch',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 8, paddingRight: 12, paddingLeft: 8,
    maxWidth: SW * 0.7,
    marginBottom: 2,
  },
  replyBar: { width: 3, backgroundColor: '#FF6B8A', borderRadius: 2, alignSelf: 'stretch' },
  replyPreviewTxt: {
    fontFamily: 'Pretendard-Regular', fontSize: 12,
    flexShrink: 1, lineHeight: 17,
  },

  // 리액션
  reactionRow: { flexDirection: 'row', gap: 2, marginTop: 2, marginHorizontal: 4 },
  reactionEmoji: { fontSize: 16 },

  // 롱프레스 메뉴
  menuSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 16,
  },
  emojiRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  emojiBtn: { padding: 6 },
  menuDivider: { height: 1, backgroundColor: '#F0EEEC' },
  menuItem: { paddingVertical: 16, paddingHorizontal: 24 },
  menuItemTxt: { fontFamily: 'Pretendard-Medium', fontSize: 16, color: '#1C1916' },

  // 답장 배너
  replyBanner: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#F9F4F5',
    borderTopWidth: 1, borderColor: '#F0EEEC',
    gap: 10,
  },
  replyBannerBar: { width: 3, height: '100%', backgroundColor: '#FF6B8A', borderRadius: 2 },
  replyBannerName: { fontFamily: 'Pretendard-SemiBold', fontSize: 12, color: '#F17088' },
  replyBannerText: { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#9B8B8E' },

  // 복사 토스트
  toast: {
    position: 'absolute', bottom: 80, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20,
  },
  toastTxt: { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#fff' },

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
    overflow: 'hidden',
  },
  profileBigName: {
    fontFamily: 'Pretendard-SemiBold', fontSize: 18, color: '#2D1B1E',
  },
});