import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePartnerProfile } from '../../contexts/PartnerProfileContext';
import { useProfile } from '../../contexts/ProfileContext';
import { auth, db } from '../../firebaseConfig';

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type Post = {
  id: string;
  authorId: string;
  authorNickname: string;
  authorProfileImage: string;
  content: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  commentCount: number;
};

// ─── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDate(ts: Timestamp): string {
  const d = ts.toDate();
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return (
    `${d.getFullYear()}.` +
    `${String(d.getMonth() + 1).padStart(2, '0')}.` +
    `${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:` +
    `${String(d.getMinutes()).padStart(2, '0')}`
  );
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

function PostCard({
  post, myUid, coupleId, onEdit, onDelete, hasNewComment,
}: {
  post: Post;
  myUid: string;
  coupleId: string;
  onEdit: (p: Post) => void;
  onDelete: (id: string) => void;
  hasNewComment?: boolean;
}) {
  const [expanded, setExpanded]     = useState(false);
  const [overflows, setOverflows]   = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const isOwn = post.authorId === myUid;

  return (
    <>
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.9}
      onPress={() =>
        router.push({
          pathname: '/feed-detail',
          params: { postId: post.id, coupleId },
        } as never)
      }
    >
      {hasNewComment && <View style={s.newCommentDot} />}
      {/* 헤더: 프로필 + 닉네임 + 날짜 + ··· */}
      <View style={s.cardHeader}>
        <Image
          source={
            post.authorProfileImage
              ? { uri: post.authorProfileImage }
              : require('../../assets/images/profile-default.png')
          }
          style={s.cardAvatar}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
        <View style={{ flex: 1 }}>
          <Text style={s.cardNickname}>{post.authorNickname}</Text>
          <Text style={s.cardDate}>{formatDate(post.createdAt)}</Text>
        </View>
        {isOwn && (
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => setMenuVisible(true)}
          >
            <Text style={s.moreBtn}>···</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 본문 */}
      <Text
        style={s.cardContent}
        numberOfLines={expanded ? undefined : 3}
        onTextLayout={e => {
          if (!overflows && e.nativeEvent.lines.length > 3) setOverflows(true);
        }}
      >
        {post.content}
      </Text>
      {overflows && !expanded && (
        <TouchableOpacity onPress={() => setExpanded(true)} activeOpacity={0.7}>
          <Text style={s.moreText}>더보기</Text>
        </TouchableOpacity>
      )}

      {/* 댓글 수 */}
      <View style={s.cardFooter}>
        <Text style={s.commentCountText}>댓글 {post.commentCount}개</Text>
      </View>
    </TouchableOpacity>

    {/* ··· 메뉴 모달 */}
    <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
      <Pressable style={s.menuOverlay} onPress={() => setMenuVisible(false)}>
        <Pressable style={s.menuCard} onPress={e => e.stopPropagation()}>
          <View style={s.menuBtnRow}>
            <TouchableOpacity style={[s.menuCardBtn, s.menuCardBtnLeft]} onPress={() => { setMenuVisible(false); onEdit(post); }} activeOpacity={0.8}>
              <Text style={s.menuCardEditTxt}>수정</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuCardBtn} onPress={() => { setMenuVisible(false); onDelete(post.id); }} activeOpacity={0.8}>
              <Text style={s.menuCardDeleteTxt}>삭제</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const [posts, setPosts]                 = useState<Post[]>([]);
  const { nickname: myNickname, profileImage: myProfileImage, isReady: profileReady } = useProfile();
  const { nickname: partnerNickname, profileImage: partnerProfileImage } = usePartnerProfile();
  const [loading, setLoading]   = useState(true);
  const [myUid, setMyUid]       = useState('');
  const [coupleId, setCoupleId] = useState('');

  // 작성/수정 모달
  const [writeVisible, setWriteVisible] = useState(false);
  const [writeText, setWriteText]       = useState('');
  const [editPost, setEditPost]         = useState<Post | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const writeDimAnim   = useRef(new Animated.Value(0)).current;
  const writeSheetAnim = useRef(new Animated.Value(300)).current;
  const writePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 0.5) closeWrite(); },
  })).current;

  const unsubRef = useRef<(() => void) | null>(null);
  const [commentIds, setCommentIds] = useState<string[]>([]);
  const unsubCommentRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    init();
    return () => {
      unsubRef.current?.();
      unsubCommentRef.current?.();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      async function confirmPartnerPosts() {
        const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
        const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
        if (!uid || !cid) return;
        const snap = await getDocs(
          query(
            collection(db, 'couples', cid, 'posts'),
            where('confirmed', '==', false),
            where('authorId', '!=', uid),
          ),
        );
        await Promise.all(snap.docs.map(d => updateDoc(d.ref, { confirmed: true })));
      }
      confirmPartnerPosts();
    }, []),
  );

  async function init() {
    const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
    const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
    setMyUid(uid);
    setCoupleId(cid);

    if (!cid) { setLoading(false); return; }

    const q = query(
      collection(db, 'couples', cid, 'posts'),
      orderBy('createdAt', 'desc'),
    );
    unsubRef.current = onSnapshot(q, snap => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)));
      setLoading(false);
    }, () => setLoading(false));

    // 내 글에 달린 unread 댓글 → postId 추적
    unsubCommentRef.current = onSnapshot(
      query(
        collection(db, 'couples', cid, 'comments'),
        where('read', '==', false),
      ),
      snap => {
        const ids = snap.docs
          .filter(d => d.data().authorId !== uid)   // 내가 쓴 댓글은 제외
          .map(d => d.data().postId ?? '')
          .filter(Boolean);
        setCommentIds([...new Set(ids)]);
      },
    );
  }

  // ── 글 작성/수정 ───────────────────────────────────────────────────────────

  function openWrite() {
    setEditPost(null);
    setWriteText('');
    writeDimAnim.setValue(0);
    writeSheetAnim.setValue(300);
    setWriteVisible(true);
    Animated.parallel([
      Animated.timing(writeDimAnim,   { toValue: 0.4, duration: 250, useNativeDriver: true }),
      Animated.spring(writeSheetAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }),
    ]).start();
  }

  function openEdit(post: Post) {
    setEditPost(post);
    setWriteText(post.content);
    writeDimAnim.setValue(0);
    writeSheetAnim.setValue(300);
    setWriteVisible(true);
    Animated.parallel([
      Animated.timing(writeDimAnim,   { toValue: 0.4, duration: 250, useNativeDriver: true }),
      Animated.spring(writeSheetAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }),
    ]).start();
  }

  function closeWrite() {
    Animated.parallel([
      Animated.timing(writeDimAnim,   { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(writeSheetAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setWriteVisible(false);
      setWriteText('');
      setEditPost(null);
    });
  }

  async function handleSubmit() {
    if (!writeText.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (editPost) {
        await updateDoc(doc(db, 'couples', coupleId, 'posts', editPost.id), {
          content: writeText.trim(),
          updatedAt: Timestamp.now(),
        });
      } else {
        await addDoc(collection(db, 'couples', coupleId, 'posts'), {
          authorId: myUid,
          authorNickname: myNickname,
          authorProfileImage: myProfileImage,
          content: writeText.trim(),
          createdAt: Timestamp.now(),
          commentCount: 0,
          confirmed: false,
        });
      }
      closeWrite();
    } catch {
      Alert.alert('저장에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── 글 삭제 ────────────────────────────────────────────────────────────────

  async function handleDelete(postId: string) {
    Alert.alert('삭제', '게시글을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'couples', coupleId, 'posts', postId));
          } catch {
            Alert.alert('삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  if (loading || !profileReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' }}>
        <ActivityIndicator color="#F17088" />
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Text style={s.headerTitle}>피드</Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>아직 글이 없어요</Text>
            <Text style={s.emptySubText}>{'첫 번째로 남겨 봐요\nTip! 댓글을 to-do 리스트처럼 활용할 수 있어요'}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            myUid={myUid}
            coupleId={coupleId}
            onEdit={openEdit}
            onDelete={handleDelete}
            hasNewComment={commentIds.includes(item.id)}
          />
        )}
      />

      {/* 플로팅 작성 버튼 */}
      <TouchableOpacity style={s.fab} onPress={openWrite} activeOpacity={0.85}>
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>

      {/* 글 작성 / 수정 모달 */}
      <Modal visible={writeVisible} transparent animationType="none" onRequestClose={closeWrite}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: writeDimAnim }]}
          pointerEvents="none"
        />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeWrite} />
          <Animated.View style={{ transform: [{ translateY: writeSheetAnim }] }}>
            <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
              <View {...writePan.panHandlers} style={{ alignItems: 'center', paddingBottom: 4 }}>
                <View style={s.handle} />
              </View>
              <Text style={s.sheetTitle}>{editPost ? '글 수정' : '글 작성'}</Text>
              <TextInput
                style={s.writeInput}
                placeholder="오늘은 어떤 하루였나요?"
                placeholderTextColor="#C8B4B8"
                value={writeText}
                onChangeText={setWriteText}
                multiline
                autoFocus
                maxLength={1000}
              />
              <TouchableOpacity
                style={[s.submitBtn, !writeText.trim() && s.submitBtnOff]}
                onPress={handleSubmit}
                disabled={!writeText.trim() || submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.submitBtnTxt}>{editPost ? '수정하기' : '등록하기'}</Text>}
              </TouchableOpacity>
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

  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAE6E1',
    padding: 16,
    marginBottom: 12,
  },
  newCommentDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F17088',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  cardAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FAD0D8',
  },
  cardNickname: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 14,
    color: '#2D1B1E',
  },
  cardDate: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#B0A0A4',
    marginTop: 1,
  },
  moreBtn: {
    fontSize: 18,
    color: '#C4A0A8',
    letterSpacing: 1,
    lineHeight: 22,
  },
  cardContent: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
    lineHeight: 22,
  },
  moreText: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 13,
    color: '#F17088',
    marginTop: 4,
  },
  cardFooter: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: '#F5ECEE',
  },
  commentCountText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#9B8B8E',
  },

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
    textAlign: 'center',
    lineHeight: 20,
  },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 110,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F17088',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fabIcon: {
    fontSize: 28,
    color: '#fff',
    lineHeight: 32,
    marginTop: -2,
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#EDD5DA', alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 17,
    color: '#2D1B1E',
    marginBottom: 14,
  },
  writeInput: {
    minHeight: 120,
    maxHeight: 240,
    backgroundColor: '#F9F4F5',
    borderRadius: 16,
    padding: 14,
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  submitBtn: {
    marginTop: 7,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnOff: { backgroundColor: '#DDACB5' },
  submitBtnTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#fff',
  },

  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: 220,
    overflow: 'hidden',
  },
  menuBtnRow: {
    flexDirection: 'row',
  },
  menuCardBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuCardBtnLeft: {
    borderRightWidth: 1,
    borderRightColor: '#E0E0E0',
  },
  menuCardEditTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#2D1B1E',
  },
  menuCardDeleteTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#FF3B30',
  },
});
