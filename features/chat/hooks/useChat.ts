import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
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
  writeBatch
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref as sRef, uploadBytes } from 'firebase/storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent
} from 'react-native';
import { auth, db } from '../../../firebaseConfig';
import { Message, buildChatItems, toKey } from '../types';

export function useChat() {
  const [loading, setLoading]     = useState(true);
  const [myUid, setMyUid]         = useState('');
  const [coupleId, setCoupleId]   = useState('');
  const [messages, setMessages]   = useState<Message[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(true);
  const [prevUid, setPrevUid]     = useState('');

  const flatListRef         = useRef<FlatList>(null);
  const isNearBottomRef     = useRef(true);
  const isLoadingMoreRef    = useRef(false);
  const lastVisibleDocRef   = useRef<any>(null);
  const prevMessagesLengthRef = useRef(0);

  // ── 초기 로드 ────────────────────────────────────────────────────────────

  useEffect(() => { init(); }, []);

  async function init() {
    try {
      let uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
      const savedPrevUid = (await AsyncStorage.getItem('prevUid')) ?? '';

      if (!uid && auth.currentUser) {
        uid = auth.currentUser.uid;
        await AsyncStorage.setItem('userUid', uid);
      }

      setMyUid(uid);
      setCoupleId(cid);
      setPrevUid(savedPrevUid);
    } catch (e) {
      // init error silently ignored
    } finally {
      setLoading(false);
    }
  }

  // ── 메시지 실시간 리스너 ──────────────────────────────────────────────────

  useEffect(() => {
    if (!coupleId) return;

    const messagesRef = collection(db, 'couples', coupleId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(50));

    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Message))
        .reverse();

      setMessages(data);

      if (snap.docs.length > 0) {
        lastVisibleDocRef.current = snap.docs[snap.docs.length - 1];
      }

      if (snap.docs.length < 50) {
        setHasMore(false);
      }
    });

    return () => unsubscribe();
  }, [coupleId]);

  // ── 읽음 처리 ────────────────────────────────────────────────────────────

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

  // ── 새 메시지 자동 스크롤 ────────────────────────────────────────────────

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

  // ── 메시지 전송 ──────────────────────────────────────────────────────────

  async function handleSend(
    inputText: string,
    replyTo: Message | null,
    sending: boolean,
    setInputText: (t: string) => void,
    setReplyTo: (m: Message | null) => void,
    setSending: (b: boolean) => void,
  ) {
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

  // ── 사진 선택 ────────────────────────────────────────────────────────────

  async function handlePickImage(
    setPendingImages: React.Dispatch<React.SetStateAction<ImagePicker.ImagePickerAsset[]>>
  ) {
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

  // ── 사진 전송 ────────────────────────────────────────────────────────────

  async function handleSendImages(
    pendingImages: ImagePicker.ImagePickerAsset[],
    uploading: boolean,
    setPendingImages: (imgs: ImagePicker.ImagePickerAsset[]) => void,
    setUploading: (b: boolean) => void,
  ) {
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

  // ── 리액션 ──────────────────────────────────────────────────────────────

  async function handleReaction(msg: Message, emoji: string) {
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

  // ── 삭제 ────────────────────────────────────────────────────────────────

  async function handleDelete(msg: Message) {
    try {
      await deleteDoc(doc(db, 'couples', coupleId, 'messages', msg.id));
    } catch {
      Alert.alert('삭제에 실패했어요.');
    }
  }

  // ── 빌드 ────────────────────────────────────────────────────────────────

  const chatItems = useMemo(() => buildChatItems(messages, myUid), [messages, myUid]);

  const lastReadId = useMemo(() => {
    const mine = messages.filter(m => m.senderId === myUid && m.read);
    return mine.length > 0 ? mine[mine.length - 1].id : '';
  }, [messages, myUid]);

  return {
    loading,
    messages,
    loadingMore,
    hasMore,
    coupleId,
    myUid,
    prevUid,
    chatItems,
    lastReadId,
    flatListRef,
    isNearBottomRef,
    handleScroll,
    handleLoadMore,
    handleSend,
    handleSendImages,
    handlePickImage,
    handleReaction,
    handleDelete,
  };
}
