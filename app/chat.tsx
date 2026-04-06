import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { cacheDirectory, downloadAsync as fsDownloadAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { router } from 'expo-router';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
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
  where,
  writeBatch
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref as sRef, uploadBytes } from 'firebase/storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import ImageCropPicker from 'react-native-image-crop-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePartnerProfile } from '../contexts/PartnerProfileContext';
import { useProfile } from '../contexts/ProfileContext';
import { auth, db } from '../firebaseConfig';

const { width: SW, height: SH } = Dimensions.get('window');

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

// ─── ImageViewerModal ─────────────────────────────────────────────────────────

function ImageViewerModal({
  visible, urls, initialIndex, onClose,
}: {
  visible: boolean;
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [saving, setSaving] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_, g) =>
      g.dy > 8 && g.dy > Math.abs(g.dx),
    onMoveShouldSetPanResponderCapture: (_, g) =>
      g.dy > 8 && g.dy > Math.abs(g.dx) * 2,
    onPanResponderMove: (_, g) => {
      if (g.dy > 0) translateY.setValue(g.dy);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.6) {
        Animated.timing(translateY, { toValue: SH, duration: 220, useNativeDriver: true }).start(onClose);
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
      setCurrentIndex(initialIndex);
    }
  }, [visible, initialIndex]);

  async function handleSave() {
    if (saving) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 저장을 위해 갤러리 접근 권한이 필요해요.');
      return;
    }
    setSaving(true);
    try {
      const url = urls[currentIndex];
      const filename = `buny_${Date.now()}.jpg`;
      const localUri = (cacheDirectory ?? '') + filename;
      await fsDownloadAsync(url, localUri);
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('저장됐어요!', '사진이 갤러리에 저장됐어요.');
    } catch {
      Alert.alert('저장 실패', '사진 저장에 실패했어요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Animated.View
        style={{ flex: 1, backgroundColor: '#000', transform: [{ translateY }] }}
      >
        {/* 이미지 스와이프 FlatList */}
        <FlatList
          ref={flatRef}
          data={urls}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: SW, offset: SW * index, index })}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
            setCurrentIndex(idx);
          }}
          renderItem={({ item }) => (
            <View style={{ width: SW, height: SH, alignItems: 'center', justifyContent: 'center' }}>
              <Image
                source={{ uri: item }}
                style={{ width: SW, height: SH }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            </View>
          )}
        />

        {/* 세로 스와이프 감지 레이어 */}
        <View
          {...panResponder.panHandlers}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }}
          pointerEvents="box-none"
        />

        {/* 헤더 */}
        <View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            paddingTop: insets.top + 8,
            paddingHorizontal: 16, paddingBottom: 12,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        >
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          {urls.length > 1 && (
            <Text style={{ color: '#fff', fontFamily: 'Pretendard-Regular', fontSize: 14 }}>
              {currentIndex + 1} / {urls.length}
            </Text>
          )}
          <TouchableOpacity onPress={handleSave} hitSlop={12} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="download-outline" size={24} color="#fff" />}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── ChatImage ────────────────────────────────────────────────────────────────

function ChatImage({ uri, style }: { uri: string; style: object }) {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <View style={[style, { backgroundColor: 'transparent', overflow: 'hidden' }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#E8E8E8' }]} />
      <Animated.Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
        onLoad={() =>
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
        }
      />
    </View>
  );
}

// ─── 이미지 그리드 ────────────────────────────────────────────────────────────

function ImageGrid({ urls, onImagePress }: { urls: string[]; onImagePress?: (index: number) => void }) {
  if (urls.length === 1) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(0)}>
        <ChatImage uri={urls[0]} style={{ width: IMG_SINGLE, height: IMG_SINGLE }} />
      </TouchableOpacity>
    );
  }
  if (urls.length === 2) {
    return (
      <View style={{ flexDirection: 'row', gap: IMG_GAP }}>
        {urls.map((u, i) => (
          <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => onImagePress?.(i)}>
            <ChatImage uri={u} style={{ width: IMG_CELL, height: IMG_CELL }} />
          </TouchableOpacity>
        ))}
      </View>
    );
  }
  if (urls.length === 3) {
    return (
      <View style={{ gap: IMG_GAP }}>
        <View style={{ flexDirection: 'row', gap: IMG_GAP }}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(0)}>
            <ChatImage uri={urls[0]} style={{ width: IMG_CELL, height: IMG_CELL }} />
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(1)}>
            <ChatImage uri={urls[1]} style={{ width: IMG_CELL, height: IMG_CELL }} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(2)}>
          <ChatImage uri={urls[2]} style={{ width: IMG_CELL * 2 + IMG_GAP, height: IMG_CELL }} />
        </TouchableOpacity>
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
          {row.map((u, ci) => (
            <TouchableOpacity key={ci} activeOpacity={0.9} onPress={() => onImagePress?.(ri * 2 + ci)}>
              <ChatImage uri={u} style={{ width: IMG_CELL, height: IMG_CELL }} />
            </TouchableOpacity>
          ))}
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

function renderHighlightedText(text: string, term: string | undefined, style: any) {
  if (!term) return <Text style={style}>{text}</Text>;
  const q = term.toLowerCase();
  const lower = text.toLowerCase();
  const parts: { t: string; hi: boolean }[] = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) { parts.push({ t: text.slice(pos), hi: false }); break; }
    if (idx > pos) parts.push({ t: text.slice(pos, idx), hi: false });
    parts.push({ t: text.slice(idx, idx + q.length), hi: true });
    pos = idx + q.length;
  }
  return (
    <Text style={style}>
      {parts.map((p, i) => p.hi
        ? <Text key={i} style={{ backgroundColor: '#FFE8ED', color: '#F17088' }}>{p.t}</Text>
        : p.t
      )}
    </Text>
  );
}

function MessageRow({
  item, myUid, partnerNick, partnerAvatar, myNick, myAvatar,
  lastReadId, chatItems, flatListRef, onLongPress, setReplyTo, setProfileModal,
  highlightId, setHighlightId, prevUid, onImagePress, searchTerm,
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
  onLongPress: (msg: Message, y: number, height: number) => void;
  setReplyTo: (m: Message | null) => void;
  setProfileModal: (m: { visible: boolean; name: string; image: string }) => void;
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
  prevUid: string;
  onImagePress?: (urls: string[], index: number) => void;
  searchTerm?: string;
}) {
  const { data: msg, showAvatar, isFirst, isLast, isSingle } = item;
  const isMe    = msg.senderId === myUid || (!!prevUid && msg.senderId === prevUid);
  const radiusStyle = getBubbleRadius(isMe, isSingle, isFirst, isLast);
  const time    = msg.createdAt ? formatTime(msg.createdAt) : '';
  const allUrls = msg.imageUrls?.length ? msg.imageUrls : msg.imageUrl ? [msg.imageUrl] : [];
  const hasImg  = allUrls.length > 0;
  const hasTxt  = !!msg.text;
  const imgOnly = hasImg && !hasTxt;

  const bubbleRef = useRef<View>(null);
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
            {isLast && <Text style={[s.readTxt, msg.id !== lastReadId && { opacity: 0 }]}>읽음</Text>}
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
            <View style={{ position: 'relative', marginTop: msg.reactions && Object.keys(msg.reactions).length > 0 ? 12 : 0 }}>
              <Animated.View ref={bubbleRef} style={[s.bubble, radiusStyle, { backgroundColor: highlightBg }]}>
                <TouchableOpacity
                  onLongPress={() => {
                    bubbleRef.current?.measure((fx, fy, w, h, px, py) => {
                      onLongPress(msg, py, h);
                    });
                  }}
                  delayLongPress={350}
                  activeOpacity={0.85}
                  style={[s.bubbleMe, imgOnly && s.bubbleImgOnly, { backgroundColor: 'transparent' }]}
                >
                  {hasImg && <ImageGrid urls={allUrls} onImagePress={(index) => onImagePress?.(allUrls, index)} />}
                  {hasTxt && renderHighlightedText(msg.text, searchTerm, s.bubbleMeTxt)}
                </TouchableOpacity>
              </Animated.View>
              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                <View style={[s.reactionBadge, { left: -16, top: -12 }]}>
                  {Object.values(msg.reactions).map((emoji, i) => (
                    <Text key={i} style={s.reactionBadgeEmoji}>{emoji}</Text>
                  ))}
                </View>
              )}
            </View>
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
            <View style={{ position: 'relative', marginTop: msg.reactions && Object.keys(msg.reactions).length > 0 ? 12 : 0 }}>
              <Animated.View ref={bubbleRef} style={[s.bubble, radiusStyle, { backgroundColor: highlightBg }]}>
                <TouchableOpacity
                  onLongPress={() => {
                    bubbleRef.current?.measure((fx, fy, w, h, px, py) => {
                      onLongPress(msg, py, h);
                    });
                  }}
                  delayLongPress={350}
                  activeOpacity={0.85}
                  style={[s.bubblePartner, imgOnly && s.bubbleImgOnly, { backgroundColor: 'transparent' }]}
                >
                  {hasImg && <ImageGrid urls={allUrls} onImagePress={(index) => onImagePress?.(allUrls, index)} />}
                  {hasTxt && renderHighlightedText(msg.text, searchTerm, s.bubblePartnerTxt)}
                </TouchableOpacity>
              </Animated.View>
              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                <View style={[s.reactionBadge, { right: -16, top: -12 }]}>
                  {Object.values(msg.reactions).map((emoji, i) => (
                    <Text key={i} style={s.reactionBadgeEmoji}>{emoji}</Text>
                  ))}
                </View>
              )}
            </View>
          </View>
          {isLast && <Text style={s.timeLeft}>{time}</Text>}
        </View>
      )}
    </View>
  );
}

// ─── ChatPhotoModal ───────────────────────────────────────────────────────────

function ChatPhotoModal({
  visible, onClose, coupleId, myUid, prevUid, initialMessages, onImagePress,
}: {
  visible: boolean;
  onClose: () => void;
  coupleId: string;
  myUid: string;
  prevUid: string;
  initialMessages: Message[];
  onImagePress?: (urls: string[], index: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SH)).current;
  const [mounted, setMounted] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; urls: string[]; senderId: string; createdAt: Timestamp | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dx > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderMove: (_, g) => { if (g.dx > 0) translateX.setValue(g.dx); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > 80 || g.vx > 0.5) {
        onClose();
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideAnim.setValue(SH);
      translateX.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }).start();
      const result = initialMessages
        .filter(m => m.imageUrls?.length || m.imageUrl)
        .map(m => ({
          id: m.id,
          urls: m.imageUrls?.length ? m.imageUrls : m.imageUrl ? [m.imageUrl] : [],
          senderId: m.senderId,
          createdAt: m.createdAt,
        }));
      setPhotos(result);
      setLoading(false);
    } else {
      Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible, initialMessages]);

  const PHOTO_SIZE = (SW - 3) / 3;

  return (
    <Modal
      visible={mounted}
      transparent={false}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: '#fff',
          transform: [{ translateY: slideAnim }, { translateX }],
        }}
      >
      <View style={{ paddingTop: insets.top, flex: 1 }}>
        <View
          {...panResponder.panHandlers}
          style={{
            height: HEADER_H, flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#F0EEEC',
          }}
        >
          <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 17, color: '#2D1B1E' }}>{'사진첩'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color="#2D1B1E" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#F17088" />
          </View>
        ) : photos.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#9B8B8E' }}>주고받은 사진이 없어요</Text>
          </View>
        ) : (
          <FlatList
            data={photos}
            keyExtractor={item => item.id}
            numColumns={3}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onImagePress?.(item.urls, 0)}
              >
                <Image
                  source={{ uri: item.urls[0] }}
                  style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, margin: 0.5 }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          />
        )}
      </View>
      </Animated.View>
    </Modal>
  );
}

// ─── ChatGrassModal ───────────────────────────────────────────────────────────

const GRASS_COLORS_MODAL = ['#F0ECE8','#E8C5C8','#DD9DA7','#D37787','#C95369','#BF2E49'];
const MONTH_KR_MODAL = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const CELL_MODAL = 18;
const GAP_MODAL = 2;
const WEEK_W_MODAL = CELL_MODAL + GAP_MODAL;

function grassLevelModal(n: number) {
  if (n === 0) return 0; if (n < 100) return 1; if (n < 300) return 2;
  if (n < 500) return 3; if (n < 1000) return 4; return 5;
}

function tooltipMsgModal(count: number) {
  if (count === 0) return '대화 없음';
  if (count < 100) return '짧게 나눴어요';
  if (count < 300) return '꽤 많이 했네요 ☺️';
  if (count < 500) return '수다쟁이들 💬';
  if (count < 1000) return '종일 붙어 있었네요 🥰';
  return '오늘 무슨 일 있었어요? ❤️‍🔥';
}

function ChatGrassModal({ visible, onClose, coupleId, onViewDate }: { visible: boolean; onClose: () => void; coupleId: string; onViewDate: (dateStr: string, messages: Message[]) => void }) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SH)).current;
  const [mounted, setMounted] = useState(false);
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dx > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderMove: (_, g) => { if (g.dx > 0) translateX.setValue(g.dx); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > 80 || g.vx > 0.5) onClose();
      else Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideAnim.setValue(SH);
      translateX.setValue(0);
      setSelectedDate(null);
      Animated.spring(slideAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !coupleId) return;
    const unsub = onSnapshot(
      collection(db, 'couples', coupleId, 'daily'),
      (snap: any) => {
        const counts: Record<string, number> = {};
        snap.forEach((d: any) => { counts[d.id] = d.data().count ?? 0; });
        setDailyCounts(counts);
      }
    );
    return () => unsub();
  }, [visible, coupleId]);

  function toKeyModal(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function buildModalGrid() {
    const today = new Date(); today.setHours(0,0,0,0);

    const keys = Object.keys(dailyCounts).filter(k => dailyCounts[k] > 0).sort();

    let firstSun: Date;
    if (keys.length > 0) {
      const oldest = new Date(keys[0] + 'T00:00:00');
      oldest.setHours(0,0,0,0);
      firstSun = new Date(oldest);
      firstSun.setDate(oldest.getDate() - oldest.getDay());
    } else {
      const ago = new Date(today);
      ago.setDate(today.getDate() - 13 * 7);
      firstSun = new Date(ago);
      firstSun.setDate(ago.getDate() - ago.getDay());
    }

    const todaySun = new Date(today);
    todaySun.setDate(today.getDate() - today.getDay());

    const weeks: { date: Date; isToday: boolean; isFuture: boolean }[][] = [];
    const cur = new Date(firstSun);
    while (cur <= todaySun) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(cur); day.setDate(cur.getDate() + d);
        week.push({ date: day, isToday: day.getTime() === today.getTime(), isFuture: day.getTime() > today.getTime() });
      }
      weeks.push(week);
      cur.setDate(cur.getDate() + 7);
    }

    const monthLabels: (string | null)[] = [];
    let lastMonth = -1;
    weeks.forEach(w => {
      const m = w[0].date.getMonth();
      monthLabels.push(m !== lastMonth ? MONTH_KR_MODAL[m] : null);
      lastMonth = m;
    });

    return { weeks, monthLabels };
  }

  const { weeks, monthLabels } = buildModalGrid();
  const CHUNK = 17;
  const chunks: typeof weeks[] = [];
  for (let i = 0; i < weeks.length; i += CHUNK) chunks.push(weeks.slice(i, i + CHUNK));

  return (
    <Modal
      visible={mounted}
      transparent={false}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: '#fff',
          transform: [{ translateY: slideAnim }, { translateX }],
        }}
      >
        <View style={{ paddingTop: insets.top, flex: 1 }}>
          <View
            style={{
              height: HEADER_H, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#F0EEEC',
            }}
            {...panResponder.panHandlers}
          >
            <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 17, color: '#2D1B1E' }}>{'대화 잔디'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color="#2D1B1E" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, alignItems: 'center' }}>
          {chunks.map((chunk, ci) => {
            const chunkMonthLabels = monthLabels.slice(ci * CHUNK, ci * CHUNK + CHUNK);
            return (
              <View key={ci} style={{ marginBottom: 24, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', height: 16, marginBottom: 4 }}>
                  {chunkMonthLabels.map((lbl, wi) => (
                    <View key={wi} style={{ width: WEEK_W_MODAL }}>
                      {lbl && <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 9, color: '#9B8B8E' }}>{lbl}</Text>}
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: GAP_MODAL }}>
                  {chunk.map((week, wi) => (
                    <View key={wi} style={{ flexDirection: 'column', gap: GAP_MODAL }}>
                      {week.map((day, di) => {
                        if (day.isFuture) return <View key={di} style={{ width: CELL_MODAL, height: CELL_MODAL }} />;
                        const ds = toKeyModal(day.date);
                        const cnt = dailyCounts[ds] ?? 0;
                        const lv = grassLevelModal(cnt);
                        return (
                          <TouchableOpacity
                            key={di}
                            style={[
                              { width: CELL_MODAL, height: CELL_MODAL, borderRadius: 4, backgroundColor: GRASS_COLORS_MODAL[lv] },
                              day.isToday && { borderWidth: 2, borderColor: '#F17088' },
                              selectedDate === ds && !day.isToday && { borderWidth: 2, borderColor: '#2D1B1E' },
                            ]}
                            onPress={() => setSelectedDate(ds)}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          </ScrollView>

          {selectedDate && (() => {
            const d = new Date(selectedDate + 'T00:00:00');
            const cnt = dailyCounts[selectedDate] ?? 0;
            return (
              <View style={{
                position: 'absolute',
                bottom: insets.bottom + 16,
                left: 16, right: 16,
                backgroundColor: '#2D1B1E',
                borderRadius: 16,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.2,
                shadowRadius: 12,
                elevation: 8,
              }}>
                <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: GRASS_COLORS_MODAL[grassLevelModal(cnt)] }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#fff' }}>
                    {d.getFullYear()}년 {d.getMonth()+1}월 {d.getDate()}일
                  </Text>
                  <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                    {cnt.toLocaleString()}개 · {tooltipMsgModal(cnt)}
                  </Text>
                </View>
                {cnt > 0 && (
                  <TouchableOpacity
                    style={{ backgroundColor: '#F17088', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}
                    onPress={async () => {
                      if (!selectedDate) return;
                      try {
                        const targetDate = new Date(selectedDate + 'T00:00:00');
                        const nextDate = new Date(targetDate); nextDate.setDate(targetDate.getDate() + 1);
                        const snap = await getDocs(query(
                          collection(db, 'couples', coupleId, 'messages'),
                          where('createdAt', '>=', Timestamp.fromDate(targetDate)),
                          where('createdAt', '<', Timestamp.fromDate(nextDate)),
                          orderBy('createdAt', 'asc')
                        ));
                        const msgs: Message[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message));
                        if (msgs.length === 0) {
                          Alert.alert('대화 없음', '해당 날짜에 대화가 없어요.');
                          return;
                        }
                        onViewDate(selectedDate, msgs);
                      } catch (e) {
                        Alert.alert('오류', '대화를 불러오는데 실패했어요.');
                      }
                    }}
                  >
                    <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, color: '#fff' }}>이 날로 이동</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── ChatSettingsModal ─────────────────────────────────────────────────────────

function ChatSettingsModal({ visible, onClose, onBgChange, photoQuality, onQualityChange }: {
  visible: boolean;
  onClose: () => void;
  onBgChange: (uri: string) => void | Promise<void>;
  photoQuality: 'low' | 'normal' | 'high';
  onQualityChange: (q: 'low' | 'normal' | 'high') => void;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SH)).current;
  const [mounted, setMounted] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dx > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderMove: (_, g) => { if (g.dx > 0) translateX.setValue(g.dx); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > 80 || g.vx > 0.5) onClose();
      else Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideAnim.setValue(SH);
      translateX.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible]);

  const qualityOptions: { key: 'low' | 'normal' | 'high'; label: string; desc: string }[] = [
    { key: 'low', label: '저화질', desc: '빠르게 전송돼요' },
    { key: 'normal', label: '일반화질', desc: '기본 설정' },
    { key: 'high', label: '고화질', desc: '업로드에 시간이 걸릴 수 있어요' },
  ];

  return (
    <Modal
      visible={mounted}
      transparent={false}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: '#fff',
          transform: [{ translateY: slideAnim }, { translateX }],
        }}
      >
        <View style={{ paddingTop: insets.top, flex: 1 }}>
          <View
            style={{
              height: HEADER_H, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#F0EEEC',
            }}
            {...panResponder.panHandlers}
          >
            <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 17, color: '#2D1B1E' }}>{'설정'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color="#2D1B1E" />
            </TouchableOpacity>
          </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#9B8B8E', marginBottom: 12 }}>배경</Text>
            <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#F0EEEC' }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#F0EEEC' }}
                onPress={() => Alert.alert('추후 공개', '기본 배경 선택은 추후 업데이트될 예정이에요.')}
              >
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E' }}>기본 배경 선택</Text>
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#C4A0A8' }}>추후 공개 →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}
                onPress={async () => {
                  try {
                    const image = await ImageCropPicker.openPicker({
                      width: SW * 3,
                      height: SH * 3,
                      cropping: true,
                      freeStyleCropEnabled: true,
                      cropperCircleOverlay: false,
                      compressImageQuality: 0.9,
                      mediaType: 'photo',
                    });
                    const uri = image.path.startsWith('file://') ? image.path : `file://${image.path}`;
                    onBgChange(uri);
                  } catch (e: any) {
                    if (e?.code !== 'E_PICKER_CANCELLED') Alert.alert('사진을 불러오는데 실패했어요.');
                  }
                }}
              >
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E' }}>앨범에서 선택</Text>
                <Ionicons name="chevron-forward" size={16} color="#C4A0A8" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#9B8B8E', marginBottom: 12 }}>사진 전송 품질</Text>
            <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#F0EEEC' }}>
              {qualityOptions.map((opt, i) => (
                <TouchableOpacity
                  key={opt.key}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    padding: 16,
                    borderBottomWidth: i < qualityOptions.length - 1 ? 1 : 0,
                    borderColor: '#F0EEEC',
                    backgroundColor: photoQuality === opt.key ? '#FFF5F7' : '#fff',
                  }}
                  onPress={() => onQualityChange(opt.key)}
                >
                  <View>
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E' }}>{opt.label}</Text>
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#9B8B8E', marginTop: 2 }}>{opt.desc}</Text>
                  </View>
                  {photoQuality === opt.key && <Ionicons name="checkmark" size={18} color="#F17088" />}
                </TouchableOpacity>
              ))}
            </View>
            {photoQuality === 'high' && (
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#F17088', marginTop: 8, paddingHorizontal: 4 }}>
                고화질 전송은 업로드 및 로딩에 시간이 소요될 수 있어요.
              </Text>
            )}
          </View>
        </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── DateChatModal ────────────────────────────────────────────────────────────

function DateChatModal({
  visible, onClose, dateStr, messages: msgs, myUid, prevUid, partnerNick, partnerAvatar, myNick, myAvatar, onImagePress, targetMessageId, searchTerm,
}: {
  visible: boolean;
  onClose: () => void;
  dateStr: string;
  messages: Message[];
  myUid: string;
  prevUid: string;
  partnerNick: string;
  partnerAvatar: string;
  myNick: string;
  myAvatar: string;
  onImagePress?: (urls: string[], index: number) => void;
  targetMessageId?: string;
  searchTerm?: string;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SH)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const flatRef = useRef<FlatList>(null);
  const [modalHighlightId, setModalHighlightId] = useState<string | null>(null);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dx > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderMove: (_, g) => { if (g.dx > 0) translateX.setValue(g.dx); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > 80 || g.vx > 0.5) onClose();
      else Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(SH);
      translateX.setValue(0);
      setModalHighlightId(null);
      Animated.spring(slideAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }).start(() => {
        if (targetMessageId) {
          const items = buildChatItems(msgs, myUid);
          const idx = items.findIndex(i => i.type === 'message' && i.data.id === targetMessageId);
          if (idx >= 0) {
            setTimeout(() => {
              flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
            }, 100);
            setTimeout(() => {
              setModalHighlightId(targetMessageId);
              setTimeout(() => setModalHighlightId(null), 1200);
            }, 500);
          }
        }
      });
    } else {
      Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible]);

  const chatItems = useMemo(() => buildChatItems(msgs, myUid), [msgs, myUid]);
  const d = new Date(dateStr + 'T00:00:00');
  const title = `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;

  const lastReadId = useMemo(() => {
    const mine = msgs.filter(m => m.senderId === myUid && m.read);
    return mine.length > 0 ? mine[mine.length - 1].id : '';
  }, [msgs, myUid]);

  return (
    <Modal visible={visible} transparent={false} animationType="none" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: '#fff', transform: [{ translateY: slideAnim }, { translateX }] }}>
        <View style={{ paddingTop: insets.top }}>
          <View
            {...panResponder.panHandlers}
            style={{ height: HEADER_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#F0EEEC' }}
          >
            <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 17, color: '#2D1B1E' }}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color="#2D1B1E" />
            </TouchableOpacity>
          </View>
        </View>
        <FlatList
          ref={flatRef}
          data={chatItems}
          keyExtractor={item => item.type === 'separator' ? `sep-${item.label}` : item.data.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: insets.bottom + 12 }}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
            }, 300);
          }}
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
                flatListRef={flatRef}
                onLongPress={() => {}}
                setReplyTo={() => {}}
                setProfileModal={() => {}}
                highlightId={modalHighlightId}
                setHighlightId={setModalHighlightId}
                prevUid={prevUid}
                onImagePress={onImagePress}
                searchTerm={searchTerm}
              />
            );
          }}
        />
      </Animated.View>
    </Modal>
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
  const [menuMsgLayout, setMenuMsgLayout] = useState<{ y: number; height: number } | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [prevUid, setPrevUid] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ visible: boolean; urls: string[]; index: number }>({
    visible: false, urls: [], index: 0,
  });
  const [showGrassModal, setShowGrassModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [chatBg, setChatBg] = useState<string | null>(null);
  const [photoQuality, setPhotoQuality] = useState<'low' | 'normal' | 'high'>('normal');
  const [dateChatModal, setDateChatModal] = useState<{ visible: boolean; dateStr: string; messages: Message[]; fromGrass?: boolean; targetMessageId?: string; searchTerm?: string }>({
    visible: false, dateStr: '', messages: [],
  });
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const moreMenuAnim = useRef(new Animated.Value(0)).current;

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
      const savedPrevUid = (await AsyncStorage.getItem('prevUid')) ?? '';

      // uid가 없으면 재인증 필요
      if (!uid && auth.currentUser) {
        uid = auth.currentUser.uid;
        await AsyncStorage.setItem('userUid', uid);
      }

      setMyUid(uid);
      setCoupleId(cid);
      setPrevUid(savedPrevUid);
      const savedBg = await AsyncStorage.getItem('chatBg');
      if (savedBg) setChatBg(savedBg);
      if (!uid || !cid) return;

    } catch (e) {
      // init error silently ignored
    } finally {
      setLoading(false);
    }
  }

  // ── 메시지 실시간 리스너 ────────────────────────────────────────────────────

  useEffect(() => {
    if (!coupleId) return;

    const messagesRef = collection(db, 'couples', coupleId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(50));

    const unsubscribe = onSnapshot(q, (snap) => {

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
      // load more error silently ignored
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

  async function handleDelete(msg: Message) {
    try {
      await deleteDoc(doc(db, 'couples', coupleId, 'messages', msg.id));
    } catch {
      Alert.alert('삭제에 실패했어요.');
    }
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
      selectionLimit: 10,
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

  // ── 더보기 메뉴 ────────────────────────────────────────────────────────────

  function openMoreMenu() {
    setShowMoreMenu(true);
    Animated.timing(moreMenuAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }

  function closeMoreMenu() {
    Animated.timing(moreMenuAnim, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(() => setShowMoreMenu(false));
  }

  function activateSearch() {
    setSearchActive(true);
    setSearchQuery('');
    setSearchResults([]);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }

  function deactivateSearch() {
    Keyboard.dismiss();
    setSearchActive(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  function handleSearchChange(text: string) {
    setSearchQuery(text);
  }

  async function submitSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearchLoading(true);
    setSearchResults([]);
    try {
      let msgs = allMessages;
      if (!allMessagesLoaded && coupleId) {
        const snap = await getDocs(query(
          collection(db, 'couples', coupleId, 'messages'),
          orderBy('createdAt', 'asc')
        ));
        msgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message));
        setAllMessages(msgs);
        setAllMessagesLoaded(true);
      }
      const lower = q.toLowerCase();
      setSearchResults(msgs.filter(m => m.text && m.text.toLowerCase().includes(lower)));
    } catch (e) {
      // search error silently ignored
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleSearchResultPress(msg: Message) {
    if (!msg.createdAt) return;
    deactivateSearch();
    const term = searchQuery.trim();
    const dateStr = toDateStr(msg.createdAt.toDate());
    const targetDate = new Date(dateStr + 'T00:00:00');
    const nextDate = new Date(targetDate); nextDate.setDate(targetDate.getDate() + 1);
    try {
      const snap = await getDocs(query(
        collection(db, 'couples', coupleId, 'messages'),
        where('createdAt', '>=', Timestamp.fromDate(targetDate)),
        where('createdAt', '<', Timestamp.fromDate(nextDate)),
        orderBy('createdAt', 'asc')
      ));
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message));
      setTimeout(() => {
        setDateChatModal({ visible: true, dateStr, messages: msgs, targetMessageId: msg.id, searchTerm: term });
      }, 200);
    } catch {}
  }

  async function navigateToDate(dateStr: string) {
    const targetDate = new Date(dateStr + 'T00:00:00');
    const nextDate = new Date(targetDate);
    nextDate.setDate(targetDate.getDate() + 1);

    const found = messages.findIndex(m => {
      if (!m.createdAt) return false;
      const d = m.createdAt.toDate();
      return d >= targetDate && d < nextDate;
    });

    if (found >= 0) {
      const chatItemIdx = chatItems.findIndex(i => i.type === 'message' && i.data.id === messages[found].id);
      if (chatItemIdx >= 0) {
        const reversedIdx = chatItems.length - 1 - chatItemIdx;
        flatListRef.current?.scrollToIndex({ index: reversedIdx, animated: true, viewPosition: 0 });
      }
    } else {
      try {
        const startTs = Timestamp.fromDate(targetDate);
        const endTs = Timestamp.fromDate(nextDate);
        const snap = await getDocs(query(
          collection(db, 'couples', coupleId, 'messages'),
          where('createdAt', '>=', startTs),
          where('createdAt', '<', endTs),
          orderBy('createdAt', 'asc'),
          limit(1)
        ));
        if (!snap.empty) {
          Alert.alert('이동', `${dateStr.replace(/-/g,'.')} 대화를 불러오려면 스크롤을 위로 올려주세요.`);
        } else {
          Alert.alert('대화 없음', '해당 날짜에 대화가 없어요.');
        }
      } catch {}
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
    <View style={[s.screen, { paddingTop: insets.top }]}>
      {chatBg && (
        <Image
          source={{ uri: chatBg }}
          style={{ position: 'absolute', top: HEADER_H, left: 0, right: 0, bottom: 0 }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      )}

      {/* ── 헤더 ── */}
      <View style={s.header}>
        {searchActive ? (
          <>
            <TouchableOpacity style={s.headerBtn} onPress={deactivateSearch} hitSlop={8}>
              <Text style={s.backArrow}>‹</Text>
            </TouchableOpacity>
            <TextInput
              ref={searchInputRef}
              style={{
                flex: 1,
                height: 36,
                backgroundColor: '#F2F2F2',
                borderRadius: 18,
                paddingHorizontal: 14,
                fontFamily: 'Pretendard-Regular',
                fontSize: 15,
                color: '#1C1916',
                marginRight: 20
              }}
              placeholder="검색어를 입력해 주세요!"
              placeholderTextColor="#C4A0A8"
              value={searchQuery}
              onChangeText={handleSearchChange}
              onSubmitEditing={submitSearch}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={submitSearch} hitSlop={8} style={{ marginLeft: -4, marginRight: 16 }}>
                <Ionicons name="search" size={20} color="#C4A0A8" />
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <TouchableOpacity style={s.headerBtn} onPress={() => router.back()} hitSlop={8}>
              <Text style={s.backArrow}>‹</Text>
            </TouchableOpacity>
            <Image
              source={require('../assets/images/logo.png')}
              style={s.headerTitle}
              contentFit="contain"
            />
            <TouchableOpacity style={s.headerBtn} onPress={openMoreMenu} hitSlop={8}>
              <Text style={s.headerMore}>⋯</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── 검색 결과 오버레이 ── */}
      {searchActive && (searchLoading || searchResults.length > 0 || (searchQuery.trim() !== '' && !searchLoading && allMessagesLoaded)) && (
        <View style={{
          position: 'absolute',
          top: HEADER_H,
          left: 0, right: 0, bottom: 0,
          backgroundColor: '#fff',
          zIndex: 50,
        }}>
          {searchLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <ActivityIndicator color="#F17088" />
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#9B8B8E' }}>
                전체 대화를 불러오는 중이에요...
              </Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#C4A0A8' }}>
                검색 결과가 없어요
              </Text>
            </View>
          ) : (
            <FlatList
              data={[...searchResults].reverse()}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => {
                const isMe = item.senderId === myUid || (!!prevUid && item.senderId === prevUid);
                const time = item.createdAt ? formatTime(item.createdAt) : '';
                const dateStr = item.createdAt ? toDateStr(item.createdAt.toDate()) : '';
                const q = searchQuery.trim().toLowerCase();
                const text = item.text ?? '';
                const matchIdx = text.toLowerCase().indexOf(q);

                return (
                  <TouchableOpacity
                    style={{
                      paddingHorizontal: 16, paddingVertical: 12,
                      borderBottomWidth: 1, borderColor: '#F0EEEC',
                      flexDirection: 'row', gap: 12, alignItems: 'flex-start',
                    }}
                    onPress={() => handleSearchResultPress(item)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={
                        isMe
                          ? (myAvatar ? { uri: myAvatar } : require('../assets/images/profile-default.png'))
                          : (partnerAvatar ? { uri: partnerAvatar } : require('../assets/images/profile-default.png'))
                      }
                      style={{ width: 36, height: 36, borderRadius: 18, flexShrink: 0 }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#2D1B1E' }}>
                          {isMe ? (myNick || '나') : (partnerNick || '상대방')}
                        </Text>
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#C4A0A8' }}>
                          {dateStr} {time}
                        </Text>
                      </View>
                      {matchIdx >= 0 ? (
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#9B8B8E', lineHeight: 20 }} numberOfLines={2}>
                          {text.slice(0, matchIdx)}
                          <Text style={{ color: '#F17088', fontFamily: 'Pretendard-SemiBold' }}>
                            {text.slice(matchIdx, matchIdx + q.length)}
                          </Text>
                          {text.slice(matchIdx + q.length)}
                        </Text>
                      ) : (
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#9B8B8E', lineHeight: 20 }} numberOfLines={2}>
                          {item.imageUrls?.length || item.imageUrl ? '📷 사진' : text}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ── 메시지 + 입력창 ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={-30}
      >
        {/* 빈 상태 */}
        {messages.length === 0 ? (
          <Pressable style={s.emptyWrap} onPress={Keyboard.dismiss}>
            <Image source={require('../assets/images/icon-chat.png')} style={{ width: 48, height: 48, marginBottom: 12 }} contentFit="contain" />
            <Text style={s.emptyTxt}>{'아직 대화가 없어요.\n먼저 말을 걸어 봐요!'}</Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1, backgroundColor: 'transparent' }}>
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
                onScrollToIndexFailed={(info) => {
                  setTimeout(() => {
                    flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
                  }, 300);
                }}
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
                      onLongPress={(msg, y, height) => {
                        setMenuMsg(msg);
                        setMenuMsgLayout({ y, height });
                      }}
                      setReplyTo={setReplyTo}
                      setProfileModal={setProfileModal}
                      highlightId={highlightId}
                      setHighlightId={setHighlightId}
                      prevUid={prevUid}
                      onImagePress={(urls, index) => setImageViewer({ visible: true, urls, index })}
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
            <View style={s.previewHeader}>
              <Text style={s.previewCount}>{pendingImages.length}장 선택됨</Text>
              <TouchableOpacity onPress={() => setPendingImages([])} hitSlop={8}>
                <Ionicons name="close" size={18} color="#9B8B8E" />
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.previewScroll}
            >
              {pendingImages.map((asset, i) => (
                <View key={i} style={s.previewThumb}>
                  <Image source={{ uri: asset.uri }} style={{ width: 72, height: 72 }} contentFit="cover" cachePolicy="memory-disk" />
                  <TouchableOpacity
                    style={s.previewRemove}
                    onPress={() => setPendingImages(imgs => imgs.filter((_, j) => j !== i))}
                    hitSlop={4}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                  <View style={s.previewOrder}>
                    <Text style={s.previewOrderTxt}>{i + 1}</Text>
                  </View>
                </View>
              ))}
              {pendingImages.length < 10 && (
                <TouchableOpacity style={s.previewAddBtn} onPress={handlePickImage}>
                  <Ionicons name="add" size={28} color="#9B8B8E" />
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[s.previewSendBtn, uploading && { opacity: 0.6 }]}
              onPress={handleSendImages}
              disabled={uploading}
            >
              {uploading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.previewSendTxt}>{'전송  '}<Ionicons name="arrow-up" size={14} color="#fff" /></Text>}
            </TouchableOpacity>
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
          <View style={{ backgroundColor: '#fff', paddingBottom: insets.bottom }}>
          <View style={s.inputBar}>
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
        </View>
      </KeyboardAvoidingView>

      {/* ── 더보기 드롭다운 오버레이 ── */}
      {showMoreMenu && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeMoreMenu}
        >
          <Animated.View
            style={{
              position: 'absolute',
              top: insets.top + HEADER_H + 4,
              right: 8,
              opacity: moreMenuAnim,
              transform: [{
                translateY: moreMenuAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-8, 0],
                }),
              }],
              backgroundColor: '#fff',
              borderRadius: 14,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 8,
              minWidth: 160,
              zIndex: 100,
            }}
          >
            {[
              { icon: 'search-outline', label: '검색', onPress: () => { closeMoreMenu(); setTimeout(() => activateSearch(), 160); } },
              { icon: 'images-outline', label: '사진첩', onPress: () => { closeMoreMenu(); setTimeout(() => setShowPhotoModal(true), 160); } },
              { icon: 'grid-outline', label: '대화 잔디', onPress: () => { closeMoreMenu(); setTimeout(() => setShowGrassModal(true), 160); } },
              { icon: 'settings-outline', label: '설정', onPress: () => { closeMoreMenu(); setTimeout(() => setShowSettingsModal(true), 160); } },
            ].map((item, i, arr) => (
              <TouchableOpacity
                key={item.label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                  borderColor: '#F0EEEC',
                }}
                onPress={item.onPress}
              >
                <Ionicons name={item.icon as any} size={18} color="#2D1B1E" />
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E' }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </Animated.View>
        </Pressable>
      )}

      {/* ── 사진첩 전체화면 모달 ── */}
      <ChatPhotoModal
        visible={showPhotoModal}
        onClose={() => setShowPhotoModal(false)}
        coupleId={coupleId}
        myUid={myUid}
        prevUid={prevUid}
        initialMessages={messages}
        onImagePress={(urls, index) => {
          setShowPhotoModal(false);
          setTimeout(() => setImageViewer({ visible: true, urls, index }), 250);
        }}
      />

      {/* ── 대화 잔디 전체화면 모달 ── */}
      <ChatGrassModal
        visible={showGrassModal}
        onClose={() => setShowGrassModal(false)}
        coupleId={coupleId}
        onViewDate={(dateStr, msgs) => {
          setShowGrassModal(false);
          setTimeout(() => setDateChatModal({ visible: true, dateStr, messages: msgs, fromGrass: true }), 300);
        }}
      />

      {/* ── 설정 전체화면 모달 ── */}
      <ChatSettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onBgChange={async (uri) => {
          setChatBg(uri);
          await AsyncStorage.setItem('chatBg', uri);
          Alert.alert('변경됐어요!', '배경이 변경됐어요. 확인해 보세요.');
        }}
        photoQuality={photoQuality}
        onQualityChange={setPhotoQuality}
      />

      {/* ── 날짜별 대화 모달 ── */}
      <DateChatModal
        visible={dateChatModal.visible}
        onClose={() => {
          const fromGrass = dateChatModal.fromGrass;
          setDateChatModal(p => ({ ...p, visible: false }));
          if (fromGrass) setTimeout(() => setShowGrassModal(true), 300);
        }}
        dateStr={dateChatModal.dateStr}
        messages={dateChatModal.messages}
        myUid={myUid}
        prevUid={prevUid}
        partnerNick={partnerNick}
        partnerAvatar={partnerAvatar}
        myNick={myNick}
        myAvatar={myAvatar}
        onImagePress={(urls, index) => setImageViewer({ visible: true, urls, index })}
        targetMessageId={dateChatModal.targetMessageId}
        searchTerm={dateChatModal.searchTerm}
      />

      {/* ── 롱프레스 오버레이 ── */}
      <Modal
        visible={!!menuMsg}
        transparent
        animationType="fade"
        onRequestClose={() => { setMenuMsg(null); setMenuMsgLayout(null); }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
          onPress={() => { setMenuMsg(null); setMenuMsgLayout(null); }}
        >
          {menuMsg && menuMsgLayout && (() => {
            const isMe = menuMsg.senderId === myUid;
            const isRecent = menuMsg.createdAt
              ? Date.now() - menuMsg.createdAt.toDate().getTime() < 600000
              : false;
            const hasDelete = isMe && isRecent;
            const emojiBarH = 46;
            const gap = 8;
            const actionItemH = 43;
            const actionCount = 2 + (hasDelete ? 1 : 0);
            const actionH = actionItemH * actionCount;
            const totalBottom = menuMsgLayout.y + menuMsgLayout.height + gap + actionH;
            const overflow = totalBottom - (SH - insets.bottom - 16);
            const shift = overflow > 0 ? overflow : 0;

            const bubbleTop = menuMsgLayout.y - shift;
            const emojiTop = Math.max(bubbleTop - emojiBarH - gap, 20);
            const actionTop = bubbleTop + menuMsgLayout.height + gap;

            return (
              <>
                {/* 메시지 버블 원위치 표시 */}
                <View
                  style={{
                    position: 'absolute',
                    top: bubbleTop,
                    left: 38, right: 38,
                    paddingHorizontal: 12,
                    alignItems: isMe ? 'flex-end' : 'flex-start',
                  }}
                  pointerEvents="none"
                >
                  <View style={[
                    {
                      borderRadius: 18,
                      paddingHorizontal: menuMsg.imageUrls?.length || menuMsg.imageUrl ? 0 : 14,
                      paddingVertical: menuMsg.imageUrls?.length || menuMsg.imageUrl ? 0 : 10,
                      maxWidth: SW * 0.7,
                    },
                    isMe
                      ? { backgroundColor: '#F2F2F2' }
                      : { backgroundColor: '#1D1D1D' },
                  ]}>
                    <Text style={{
                      fontSize: 15,
                      color: isMe ? '#1C1916' : '#fff',
                      fontFamily: 'Pretendard-Regular',
                      lineHeight: 22,
                    }}>
                      {menuMsg.text}
                    </Text>
                  </View>
                </View>

                {/* 이모지 바 — 메시지 위 (상대방 메시지만) */}
                {!isMe && (
                <View
                  style={{
                    position: 'absolute',
                    top: emojiTop,
                    left: 38, right: 38,
                    paddingHorizontal: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <View style={{
                    backgroundColor: '#fff',
                    borderRadius: 30,
                    paddingHorizontal: 8, paddingVertical: 6,
                    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
                  }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {['❤️','👍','👎','😂','😢','😡','🙏'].map(emoji => (
                        <TouchableOpacity
                          key={emoji}
                          onPress={() => { handleReaction(menuMsg, emoji); setMenuMsg(null); setMenuMsgLayout(null); }}
                          style={{ padding: 4 }}
                        >
                          <Text style={{ fontSize: 26 }}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
                )}

                {/* 액션 버튼 — 메시지 아래 */}
                <Pressable
                  style={{
                    position: 'absolute',
                    top: actionTop,
                    left: 38, right: 38,
                    paddingHorizontal: 12,
                    alignItems: isMe ? 'flex-end' : 'flex-start',
                  }}
                  onPress={e => e.stopPropagation()}
                >
                  <View style={{
                    backgroundColor: '#fff',
                    borderRadius: 14,
                    minWidth: 180,
                    overflow: 'hidden',
                    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
                  }}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#F0EEEC' }}
                      onPress={() => { setReplyTo(menuMsg); setMenuMsg(null); setMenuMsgLayout(null); }}
                    >
                      <Text style={{ fontSize: 15, color: '#1C1916', fontFamily: 'Pretendard-Regular' }}>답장하기</Text>
                      <Ionicons name="arrow-undo-outline" size={18} color="#1C1916" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                        paddingHorizontal: 16, paddingVertical: 14,
                        borderBottomWidth: hasDelete ? 1 : 0,
                        borderColor: '#F0EEEC',
                      }}
                      onPress={() => {
                        if (menuMsg.text) {
                          Clipboard.setStringAsync(menuMsg.text);
                          setCopyToast(true);
                          setTimeout(() => setCopyToast(false), 1500);
                        }
                        setMenuMsg(null); setMenuMsgLayout(null);
                      }}
                    >
                      <Text style={{ fontSize: 15, color: '#1C1916', fontFamily: 'Pretendard-Regular' }}>복사하기</Text>
                      <Ionicons name="copy-outline" size={18} color="#1C1916" />
                    </TouchableOpacity>
                    {hasDelete && (
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 }}
                        onPress={() => { handleDelete(menuMsg); setMenuMsg(null); setMenuMsgLayout(null); }}
                      >
                        <Text style={{ fontSize: 15, color: '#FF3B30', fontFamily: 'Pretendard-Regular' }}>삭제하기</Text>
                        <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                      </TouchableOpacity>
                    )}
                  </View>
                </Pressable>
              </>
            );
          })()}
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

      {/* ── 이미지 풀스크린 뷰어 ── */}
      <ImageViewerModal
        visible={imageViewer.visible}
        urls={imageViewer.urls}
        initialIndex={imageViewer.index}
        onClose={() => setImageViewer(p => ({ ...p, visible: false }))}
      />
    </View>
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
    alignItems: 'flex-end', gap: 6,
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
    paddingBottom: 12,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  previewCount: {
    fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#2D1B1E',
  },
  previewScroll: {
    paddingHorizontal: 12, paddingBottom: 4, gap: 8,
  },
  previewThumb: {
    width: 72, height: 72, borderRadius: 10,
    overflow: 'hidden', position: 'relative',
  },
  previewRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewOrder: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
  },
  previewOrderTxt: {
    fontFamily: 'Pretendard-Bold', fontSize: 11, color: '#fff',
  },
  previewAddBtn: {
    width: 72, height: 72, borderRadius: 10,
    backgroundColor: '#F2F2F2',
    alignItems: 'center', justifyContent: 'center',
  },
  previewSendBtn: {
    marginHorizontal: 16, marginTop: 8,
    height: 44, borderRadius: 22,
    backgroundColor: '#1D1D1D',
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
  },
  previewSendTxt: {
    fontFamily: 'Pretendard-SemiBold', fontSize: 15, color: '#fff',
  },

  // 입력창
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
    borderTopWidth: 1, borderColor: '#F0EEEC',
    gap: 8,
  },
  photoBtn: {
    width: 36, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    maxHeight: 5 * 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    textAlignVertical: 'center',
    backgroundColor: '#F2F2F2',
    borderRadius: 20,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#1C1916',
    lineHeight: 20,
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
  reactionBadge: {
    position: 'absolute',
    flexDirection: 'row',
    backgroundColor: '#e2e2e2',
    borderRadius: 20,
    paddingHorizontal: 6, paddingVertical: 8,
    gap: 1,
  },
  reactionBadgeEmoji: { fontSize: 16 },


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