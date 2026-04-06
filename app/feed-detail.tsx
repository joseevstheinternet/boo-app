import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { usePartnerProfile } from '../contexts/PartnerProfileContext';
import { useProfile } from '../contexts/ProfileContext';

import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, db } from '../firebaseConfig';

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

type Comment = {
  id: string;
  authorId: string;
  authorNickname: string;
  authorProfileImage: string;
  content: string;
  createdAt: Timestamp;
  parentId?: string;
  isChecklistItem?: boolean;
  checked?: boolean;
};

type CommentThread = {
  comment: Comment;
  replies: Comment[];
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

// ─── SwipeActions ─────────────────────────────────────────────────────────────

function SwipeActions({
  onEdit,
  onDelete,
  height,
}: {
  onEdit: () => void;
  onDelete: () => void;
  height: number;
}) {
  return (
    <View style={[sa.wrap, height > 0 && { height }]}>
      <TouchableOpacity style={sa.editBtn} onPress={onEdit} activeOpacity={0.8}>
        <Text style={sa.editTxt}>수정</Text>
      </TouchableOpacity>
      <TouchableOpacity style={sa.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
        <Text style={sa.deleteTxt}>삭제</Text>
      </TouchableOpacity>
    </View>
  );
}

const sa = StyleSheet.create({
  wrap:      { flexDirection: 'row', alignItems: 'stretch' },
  editBtn:   { backgroundColor: '#F0E0E4', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  editTxt:   { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#C0455E' },
  deleteBtn: { backgroundColor: '#F17088', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  deleteTxt: { fontFamily: 'Pretendard-Medium', fontSize: 13, color: '#fff' },
});

// 댓글 행 외부 컨테이너 (overflow:hidden + borderRadius로 카드+버튼 통합)
const cr = StyleSheet.create({
  outer: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EAE6E1',
    backgroundColor: '#fff',
    marginBottom: 6,
  },
  outerReply: {
    marginLeft: 28,
    borderColor: '#F0E8EA',
    backgroundColor: '#FBF7F8',
  },
});

// 우측 스와이프 답글 액션
const sw = StyleSheet.create({
  replyAction: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginRight: 4,
  },
});

// 중앙 카드 메뉴 (게시글 & 댓글 공용)
const cm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: 220,
    overflow: 'hidden',
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  btnRow: {
    flexDirection: 'row',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLeft: {
    borderRightWidth: 1,
    borderRightColor: '#E0E0E0',
  },
  editTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#2D1B1E',
  },
  deleteTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#FF3B30',
  },
});

// 플로팅 원형 메뉴
const fp = StyleSheet.create({
  circleWrap: {
    position: 'absolute',
    width: 48,
    height: 48,
  },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.13,
    shadowRadius: 8,
    elevation: 8,
  },
  circleDelete: {
    backgroundColor: '#FFF0F2',
  },
  editTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 13,
    color: '#2D1B1E',
  },
  deleteTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 13,
    color: '#F17088',
  },
});

// ─── CommentRow ───────────────────────────────────────────────────────────────

function CommentRow({
  comment,
  isReply,
  myUid,
  openSwipeableRef,
  onReply,
  onEdit,
  onDelete,
  onToggleCheck,
}: {
  comment: Comment;
  isReply: boolean;
  myUid: string;
  openSwipeableRef: React.MutableRefObject<Swipeable | null>;
  onReply: (c: Comment) => void;
  onEdit: (c: Comment) => void;
  onDelete: (c: Comment) => void;
  onToggleCheck: (c: Comment) => void;
}) {
  const CIRCLE = 48;

  const swipeRef     = useRef<Swipeable>(null);
  const moreRef      = useRef<TouchableOpacity>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPos, setMenuPos]         = useState({ x: 0, y: 0 });
  const editY    = useRef(new Animated.Value(0)).current;
  const deleteY  = useRef(new Animated.Value(0)).current;
  const editOp   = useRef(new Animated.Value(0)).current;
  const deleteOp = useRef(new Animated.Value(0)).current;
  const isOwn = comment.authorId === myUid;

  const openMenu = () => {
    (moreRef.current as any)?.measureInWindow((x: number, y: number, w: number, h: number) => {
      // pair (48+4+48=100px) centered on button; each circle top = button center
      const pairLeft = x + w / 2 - 50 - 24;   // 왼쪽으로 24px
      setMenuPos({ x: pairLeft, y: y + h / 2 - CIRCLE / 2 });
      setMenuVisible(true);
      editY.setValue(0);   deleteY.setValue(0);
      editOp.setValue(0);  deleteOp.setValue(0);
      Animated.stagger(55, [
        Animated.parallel([
          Animated.spring(editY,  { toValue: -44, stiffness: 260, damping: 18, useNativeDriver: true }),
          Animated.timing(editOp, { toValue: 1, duration: 160, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.spring(deleteY,  { toValue: -44, stiffness: 260, damping: 18, useNativeDriver: true }),
          Animated.timing(deleteOp, { toValue: 1, duration: 160, useNativeDriver: true }),
        ]),
      ]).start();
    });
  };

  const closeMenu = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(editY,    { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(deleteY,  { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(editOp,   { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(deleteOp, { toValue: 0, duration: 130, useNativeDriver: true }),
    ]).start(() => { setMenuVisible(false); cb?.(); });
  };

  return (
    <View style={[cr.outer, isReply && cr.outerReply]}>
    <Swipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      overshootLeft={false}
      renderLeftActions={() => (
        <View style={sw.replyAction}>
          <MaterialCommunityIcons name="reply" size={20} color="#F17088" />
        </View>
      )}
      renderRightActions={() =>
        isOwn ? (
          <SwipeActions
            height={rowHeight}
            onEdit={() => {
              swipeRef.current?.close();
              onEdit(comment);
            }}
            onDelete={() => {
              swipeRef.current?.close();
              onDelete(comment);
            }}
          />
        ) : null
      }
      onSwipeableOpen={(direction) => {
        if (direction === 'left') {
          // 우측 스와이프 → 답글
          onReply(comment);
          swipeRef.current?.close();
        } else {
          // 좌측 스와이프 → 수정/삭제
          if (openSwipeableRef.current && openSwipeableRef.current !== swipeRef.current) {
            openSwipeableRef.current.close();
          }
          openSwipeableRef.current = swipeRef.current;
        }
      }}
    >
      <View
        style={[s.commentRow, isReply && s.replyRow]}
        onLayout={e => setRowHeight(e.nativeEvent.layout.height)}
      >
        {isReply && <View style={s.replyLine} />}
        <Image
          source={
            comment.authorProfileImage
              ? { uri: comment.authorProfileImage }
              : require('../assets/images/profile-default.png')
          }
          style={s.commentAvatar}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
        <View style={{ flex: 1 }}>
          <View style={[s.commentMeta, !comment.isChecklistItem && { marginBottom: 2 }]}>
            <Text style={s.commentNickname}>{comment.authorNickname}</Text>
            <Text style={s.commentDate}>{formatDate(comment.createdAt)}</Text>
            <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {!isReply && (
                <TouchableOpacity
                  onPress={() => onReply(comment)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <MaterialCommunityIcons name="reply" size={16} color="#C4A0A8" />
                </TouchableOpacity>
              )}
              {isOwn && (
                <TouchableOpacity
                  ref={moreRef}
                  onPress={openMenu}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={s.commentMoreBtn}>···</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {comment.isChecklistItem && (
              <TouchableOpacity
                onPress={() => onToggleCheck(comment)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={{ marginRight: 6 }}
              >
                <View style={[s.checkbox, comment.checked && s.checkboxChecked]}>
                  {comment.checked && <Text style={s.checkmark}>✓</Text>}
                </View>
              </TouchableOpacity>
            )}
            <Text style={[s.commentContent, comment.checked && { textDecorationLine: 'line-through', color: '#B0A0A4' }]}>
              {comment.content}
            </Text>
          </View>
        </View>
      </View>
    </Swipeable>

    {/* 댓글 플로팅 메뉴 */}
    <Modal visible={menuVisible} transparent animationType="none" onRequestClose={() => closeMenu()}>
      <Pressable style={{ flex: 1 }} onPress={() => closeMenu()}>
        {/* 수정 원형 버튼 */}
        <Animated.View style={[fp.circleWrap, {
          left: menuPos.x, top: menuPos.y,
          opacity: editOp, transform: [{ translateY: editY }],
        }]}>
          <TouchableOpacity style={fp.circle} onPress={() => closeMenu(() => onEdit(comment))} activeOpacity={0.8}>
            <Text style={fp.editTxt}>수정</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* 삭제 원형 버튼 (수정 오른쪽, 4px 간격) */}
        <Animated.View style={[fp.circleWrap, {
          left: menuPos.x + CIRCLE + 4, top: menuPos.y,
          opacity: deleteOp, transform: [{ translateY: deleteY }],
        }]}>
          <TouchableOpacity style={[fp.circle, fp.circleDelete]} onPress={() => closeMenu(() => onDelete(comment))} activeOpacity={0.8}>
            <Text style={fp.deleteTxt}>삭제</Text>
          </TouchableOpacity>
        </Animated.View>
      </Pressable>
    </Modal>
    </View>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function FeedDetailScreen() {
  const { postId, coupleId } = useLocalSearchParams<{ postId: string; coupleId: string }>();

  const [post, setPost]                   = useState<Post | null>(null);
  const [comments, setComments]           = useState<Comment[]>([]);
  const [loadingPost, setLoadingPost]     = useState(true);
  const [myUid, setMyUid]                 = useState('');
  const { nickname: myNickname, profileImage: myProfileImage, isReady: profileReady } = useProfile();
  const { nickname: partnerNickname, profileImage: partnerProfileImage, isReady: partnerReady } = usePartnerProfile();

  // 댓글 입력
  const LINE_HEIGHT = 20;
  const INPUT_PADDING_VERTICAL = 8;
  const MIN_HEIGHT = LINE_HEIGHT + INPUT_PADDING_VERTICAL * 2;        // 36
  const MAX_HEIGHT = LINE_HEIGHT * 5 + INPUT_PADDING_VERTICAL * 2;   // 116

  const [inputText, setInputText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_HEIGHT);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [isChecklistInput, setIsChecklistInput] = useState(false);

  // 댓글 수정
  const [editingComment, setEditingComment] = useState<Comment | null>(null);


  // 게시글 메뉴
  const [postMenuVisible, setPostMenuVisible] = useState(false);

  // 게시글 수정 모달
  const [editPostVisible, setEditPostVisible] = useState(false);
  const [editPostText, setEditPostText] = useState('');

  const inputRef           = useRef<TextInput>(null);
  const scrollRef          = useRef<ScrollView>(null);
  const openSwipeableRef   = useRef<Swipeable | null>(null);
  const unsubPostRef       = useRef<(() => void) | null>(null);
  const unsubCommentsRef   = useRef<(() => void) | null>(null);

  function handleChangeText(text: string) {
    setInputText(text);
    const lines = text === '' ? 1 : text.split('\n').length;
    const clamped = Math.min(Math.max(lines, 1), 5);
    setInputHeight(clamped * LINE_HEIGHT + INPUT_PADDING_VERTICAL * 2);
  }

  useEffect(() => {
    init();
    return () => {
      unsubPostRef.current?.();
      unsubCommentsRef.current?.();
    };
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => { show.remove(); hide.remove(); };
  }, []);


  async function init() {
    try {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      setMyUid(uid);


      if (!coupleId || !postId) return;

      // 게시글 실시간 리스너
      unsubPostRef.current = onSnapshot(doc(db, 'couples', coupleId, 'posts', postId), snap => {
        if (snap.exists()) setPost({ id: snap.id, ...snap.data() } as Post);
        setLoadingPost(false);
      }, () => setLoadingPost(false));

      // 댓글 실시간 리스너
      const q = query(
        collection(db, 'couples', coupleId, 'posts', postId, 'comments'),
        orderBy('createdAt', 'asc'),
      );
      unsubCommentsRef.current = onSnapshot(q, snap => {
        setComments(snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          isChecklistItem: d.data().isChecklistItem ?? false,
          checked: d.data().checked ?? false,
        } as Comment)));
      });

      // 플랫 컬렉션에서 이 게시글의 unread 댓글 일괄 read: true
      getDocs(query(
        collection(db, 'couples', coupleId, 'comments'),
        where('postId', '==', postId),
        where('read', '==', false),
      )).then(flatSnap => {
        flatSnap.docs.forEach(d => {
          updateDoc(d.ref, { read: true }).catch(() => {});
          updateDoc(doc(db, 'couples', coupleId, 'posts', postId, 'comments', d.id), { read: true }).catch(() => {});
        });
      }).catch(() => {});
    } catch (e) {
      // init error silently ignored
    } finally {
      setLoadingPost(false);
    }
  }

  // ── 댓글 트리 빌드 ────────────────────────────────────────────────────────

  const threads = useMemo<CommentThread[]>(() => {
    const top = comments.filter(c => !c.parentId);
    return top.map(c => ({
      comment: c,
      replies: comments.filter(r => r.parentId === c.id),
    }));
  }, [comments]);

  // ── 게시글 수정/삭제 ──────────────────────────────────────────────────────

  function handlePostMenu() {
    setPostMenuVisible(true);
  }

  function handlePostEdit() {
    setPostMenuVisible(false);
    if (!post) return;
    setEditPostText(post.content);
    setEditPostVisible(true);
  }

  async function handlePostEditSave() {
    if (!editPostText.trim()) return;
    try {
      await updateDoc(doc(db, 'couples', coupleId, 'posts', postId), {
        content: editPostText.trim(),
        updatedAt: Timestamp.now(),
      });
    } catch {
      Alert.alert('수정에 실패했어요.');
    }
    setEditPostVisible(false);
  }

  function handlePostDelete() {
    setPostMenuVisible(false);
    Alert.alert('삭제', '게시글을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          await deleteDoc(doc(db, 'couples', coupleId, 'posts', postId));
          router.back();
        },
      },
    ]);
  }

  // ── 댓글 전송 ─────────────────────────────────────────────────────────────

  async function handleSendComment() {
    if (!inputText.trim() || sending) return;
    setSending(true);
    try {
      if (editingComment) {
        // 댓글 수정 (서브컬렉션 + flat 컬렉션)
        const update = { content: inputText.trim() };
        await Promise.all([
          updateDoc(
            doc(db, 'couples', coupleId, 'posts', postId, 'comments', editingComment.id),
            update,
          ),
          updateDoc(
            doc(db, 'couples', coupleId, 'comments', editingComment.id),
            update,
          ),
        ]);
        setEditingComment(null);
      } else {
        // 새 댓글 / 답글 (서브컬렉션 저장 후 같은 ID로 flat 컬렉션에도 저장)
        const payload: Record<string, unknown> = {
          authorId: myUid,
          authorNickname: myNickname,
          authorProfileImage: myProfileImage,
          content: inputText.trim(),
          createdAt: Timestamp.now(),
          read: false,
          receiverId: post?.authorId ?? '',
          postId,
        };
        if (replyTo) payload.parentId = replyTo.id;
        if (isChecklistInput) { payload.isChecklistItem = true; payload.checked = false; }

        const commentRef = await addDoc(
          collection(db, 'couples', coupleId, 'posts', postId, 'comments'),
          payload,
        );
        await setDoc(
          doc(db, 'couples', coupleId, 'comments', commentRef.id),
          payload,
        );
        await updateDoc(doc(db, 'couples', coupleId, 'posts', postId), {
          commentCount: increment(1),
        });
        if (replyTo) {
          const parentId = replyTo.id;
          setTimeout(() => {
            const idx = comments.findIndex(c => c.id === parentId);
            if (idx >= 0) {
              scrollRef.current?.scrollTo({ y: 200 + idx * 72, animated: true });
            }
          }, 300);
        } else {
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
        }
        setReplyTo(null);
      }
      setInputText('');
      setInputHeight(MIN_HEIGHT);
      setIsChecklistInput(false);
      Keyboard.dismiss();
    } catch {
      Alert.alert('전송에 실패했어요.');
    } finally {
      setSending(false);
    }
  }

  // ── 댓글 수정 시작 ────────────────────────────────────────────────────────

  function startEditComment(comment: Comment) {
    setEditingComment(comment);
    setReplyTo(null);
    setInputText(comment.content);
    setInputHeight(MIN_HEIGHT);
    inputRef.current?.focus();
  }

  // ── 댓글 삭제 ─────────────────────────────────────────────────────────────

  function handleDeleteComment(comment: Comment) {
    Alert.alert('삭제', '댓글을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          try {
            await Promise.all([
              deleteDoc(doc(db, 'couples', coupleId, 'posts', postId, 'comments', comment.id)),
              deleteDoc(doc(db, 'couples', coupleId, 'comments', comment.id)),
            ]);
            await updateDoc(doc(db, 'couples', coupleId, 'posts', postId), {
              commentCount: increment(-1),
            });
          } catch {
            Alert.alert('삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  // ── 댓글 체크 토글 ────────────────────────────────────────────────────────

  async function handleToggleCheck(comment: Comment) {
    try {
      await updateDoc(
        doc(db, 'couples', coupleId, 'posts', postId, 'comments', comment.id),
        { checked: !comment.checked },
      );
    } catch {
      Alert.alert('변경에 실패했어요.');
    }
  }

  // ── 답글 시작 ─────────────────────────────────────────────────────────────

  function startReply(comment: Comment) {
    setReplyTo(comment);
    setEditingComment(null);
    setInputText('');
    setInputHeight(MIN_HEIGHT);
    inputRef.current?.focus();
  }

  function cancelReplyOrEdit() {
    setReplyTo(null);
    setEditingComment(null);
    setInputText('');
    setInputHeight(MIN_HEIGHT);
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  if (loadingPost || !profileReady || !partnerReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' }}>
        <ActivityIndicator color="#F17088" />
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <SafeAreaView style={s.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ── 헤더 */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.backBtn}>‹</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>피드</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* ── 스크롤 영역 */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
        >
          {post && (
            <>
              {/* 게시글 본문 */}
              <View style={s.postSection}>
                <View style={s.postHeader}>
                  <Image
                    source={
                      post.authorProfileImage
                        ? { uri: post.authorProfileImage }
                        : require('../assets/images/profile-default.png')
                    }
                    style={s.postAvatar}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.postNickname}>{post.authorNickname}</Text>
                    <Text style={s.postDate}>{formatDate(post.createdAt)}</Text>
                  </View>
                  {post.authorId === myUid && (
                    <TouchableOpacity
                      onPress={handlePostMenu}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={s.moreBtn}>···</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={s.postContent}>{post.content}</Text>
                {post.updatedAt && (
                  <Text style={s.editedLabel}>수정됨</Text>
                )}
              </View>

              {/* 댓글 섹션 */}
              <View style={s.commentsSection}>
                <Text style={s.commentHeader}>댓글 {post.commentCount}개</Text>

                {threads.length === 0 ? (
                  <Text style={s.noCommentText}>첫 번째 댓글을 남겨보세요</Text>
                ) : (
                  threads.map(({ comment, replies }) => (
                    <View key={comment.id}>
                      <CommentRow
                        comment={comment}
                        isReply={false}
                        myUid={myUid}
                        openSwipeableRef={openSwipeableRef}
                        onReply={startReply}
                        onEdit={startEditComment}
                        onDelete={handleDeleteComment}
                        onToggleCheck={handleToggleCheck}
                      />
                      {replies.map(reply => (
                        <View key={reply.id}>
                          <CommentRow
                            comment={reply}
                            isReply={true}
                            myUid={myUid}
                            openSwipeableRef={openSwipeableRef}
                            onReply={startReply}
                            onEdit={startEditComment}
                            onDelete={handleDeleteComment}
                            onToggleCheck={handleToggleCheck}
                          />
                        </View>
                      ))}
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>

        {/* ── 게시글 메뉴 모달 */}
        <Modal visible={postMenuVisible} transparent animationType="fade" onRequestClose={() => setPostMenuVisible(false)}>
          <Pressable style={cm.overlay} onPress={() => setPostMenuVisible(false)}>
            <Pressable style={cm.card} onPress={e => e.stopPropagation()}>
              <View style={cm.btnRow}>
                <TouchableOpacity style={[cm.btn, cm.btnLeft]} onPress={handlePostEdit} activeOpacity={0.8}>
                  <Text style={cm.editTxt}>수정</Text>
                </TouchableOpacity>
                <TouchableOpacity style={cm.btn} onPress={handlePostDelete} activeOpacity={0.8}>
                  <Text style={cm.deleteTxt}>삭제</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── 게시글 수정 모달 */}
        <Modal visible={editPostVisible} transparent animationType="fade" onRequestClose={() => setEditPostVisible(false)}>
          <Pressable style={cm.overlay} onPress={() => setEditPostVisible(false)}>
            <Pressable style={s.editPostCard} onPress={e => e.stopPropagation()}>
              <Text style={s.editPostTitle}>글 수정</Text>
              <TextInput
                style={s.editPostInput}
                value={editPostText}
                onChangeText={setEditPostText}
                multiline
                autoFocus
              />
              <View style={cm.btnRow}>
                <TouchableOpacity style={[cm.btn, cm.btnLeft]} onPress={() => setEditPostVisible(false)} activeOpacity={0.8}>
                  <Text style={cm.editTxt}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity style={cm.btn} onPress={handlePostEditSave} activeOpacity={0.8}>
                  <Text style={cm.deleteTxt}>저장</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── 답글/수정 모드 배너 */}
        {(replyTo || editingComment) && (
          <View style={s.replyBanner}>
            <Text style={s.replyBannerText}>
              {editingComment
                ? '댓글 수정 중'
                : `@${replyTo!.authorNickname} 에게 답글 작성 중`}
            </Text>
            <TouchableOpacity onPress={cancelReplyOrEdit} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={s.replyBannerCancel}>취소</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 체크리스트 토글 */}
        <TouchableOpacity
          style={[s.checklistToggleBar, isChecklistInput && s.checklistToggleBarOn]}
          onPress={() => setIsChecklistInput(v => !v)}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons
            name={isChecklistInput ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={17}
            color={isChecklistInput ? '#F17088' : '#B0A0A4'}
          />
          <Text style={[s.checklistToggleLbl, isChecklistInput && s.checklistToggleLblOn]}>
            체크리스트로 등록
          </Text>
          <Switch
            value={isChecklistInput}
            onValueChange={setIsChecklistInput}
            trackColor={{ false: '#EDD5DA', true: '#F17088' }}
            thumbColor="#fff"
            style={{ marginLeft: 'auto', transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
          />
        </TouchableOpacity>

        {/* ── 댓글 입력창 */}
        <View style={[s.inputBar, { paddingBottom: keyboardVisible ? 5 : 4 + insets.bottom }]}>
          <Image
            source={
              myProfileImage
                ? { uri: myProfileImage }
                : require('../assets/images/profile-default.png')
            }
            style={s.inputAvatar}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <TextInput
            ref={inputRef}
            // textAlignVertical prop 제거 (style에서만 선언)
            style={[
              s.commentInput,
              { height: inputHeight },        // height만, maxHeight 제거
            ]}
            placeholder={replyTo ? `@${replyTo.authorNickname}에게 답글...` : '댓글 작성...'}
            placeholderTextColor="#C8B4B8"
            value={inputText}
            onChangeText={handleChangeText}
            multiline
            scrollEnabled={inputHeight >= MAX_HEIGHT}
            maxLength={500}
          />
          <TouchableOpacity
            style={[s.sendBtn, !inputText.trim() && s.sendBtnOff]}
            onPress={handleSendComment}
            disabled={!inputText.trim() || sending}
            activeOpacity={0.8}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.sendBtnTxt}>등록</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },

  // 헤더
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#F0EAEB',
    backgroundColor: '#FAFAFA',
  },
  backBtn: {
    fontSize: 28,
    color: '#2D1B1E',
    lineHeight: 32,
  },
  headerTitle: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2D1B1E',
  },

  // 게시글
  postSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAE6E1',
    padding: 16,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  postAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FAD0D8',
  },
  postNickname: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#2D1B1E',
  },
  postDate: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#B0A0A4',
    marginTop: 2,
  },
  moreBtn: {
    fontSize: 18,
    color: '#C4A0A8',
    letterSpacing: 1,
    lineHeight: 22,
  },
  postContent: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 15,
    color: '#2D1B1E',
    lineHeight: 24,
  },
  editedLabel: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 11,
    color: '#B0A0A4',
    marginTop: 6,
  },

  // 댓글 섹션
  commentsSection: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  commentHeader: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 14,
    color: '#2D1B1E',
    marginBottom: 12,
  },
  noCommentText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 13,
    color: '#B0A0A4',
    textAlign: 'center',
    paddingVertical: 20,
  },

  // 댓글 행 (border/radius/margin/bg는 cr.outer 가 담당)
  commentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  replyRow: {
    backgroundColor: '#FBF7F8',
  },
  replyLine: {
    position: 'absolute',
    left: 6,
    top: 12,
    bottom: 12,
    width: 2,
    borderRadius: 1,
    backgroundColor: '#EDD5DA',
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FAD0D8',
    flexShrink: 0,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  commentNickname: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 13,
    color: '#2D1B1E',
  },
  commentDate: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 11,
    color: '#B0A0A4',
  },
  commentContent: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#2D1B1E',
    lineHeight: 20,
  },
  replyBtn: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 12,
    color: '#C4A0A8',
  },
  commentMoreBtn: {
    fontSize: 14,
    color: '#C4A0A8',
    letterSpacing: 1,
    lineHeight: 16,
  },
  checkbox: {
    width: 18, height: 18, borderRadius: 5,
    borderWidth: 1.5, borderColor: '#D4C0C4',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#F17088',
    borderColor: '#F17088',
  },
  checkmark: {
    fontSize: 11, color: '#fff',
    fontFamily: 'Pretendard-Bold', lineHeight: 14,
  },

  // 답글/수정 배너
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFF0F3',
    borderTopWidth: 1,
    borderColor: '#F9C0CB',
  },
  replyBannerText: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#C0455E',
    flex: 1,
  },
  replyBannerCancel: {
    fontFamily: 'Pretendard-Medium',
    fontSize: 12,
    color: '#F17088',
    marginLeft: 10,
  },

  // 체크리스트 토글 바
  checklistToggleBar: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 9,
    backgroundColor: '#FAFAFA',
    borderTopWidth: 1, borderColor: '#F0EAEB',
  },
  checklistToggleBarOn: {
    backgroundColor: '#FFF0F3',
    borderColor: '#F9C0CB',
  },
  checklistToggleLbl: {
    fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#B0A0A4',
  },
  checklistToggleLblOn: {
    fontFamily: 'Pretendard-Medium', color: '#F17088',
  },

  // 입력창
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',  // center → flex-end 로 변경
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 5,
    paddingBottom: 4,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: '#F0EAEB',
  },
  inputAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FAD0D8',
    flexShrink: 0,
    marginBottom: 2,
  },
  commentInput: {
    flexShrink: 1,
    flexGrow: 1,
    backgroundColor: '#F9F4F5',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#2D1B1E',
    textAlignVertical: 'top',
    includeFontPadding: false,
  },
  sendBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: '#DDACB5' },
  sendBtnTxt: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 13,
    color: '#fff',
  },

  // 게시글 수정 모달
  editPostCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginHorizontal: 28,
    padding: 20,
  },
  editPostTitle: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#2D1B1E',
    marginBottom: 12,
    textAlign: 'center',
  },
  editPostInput: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#2D1B1E',
    borderWidth: 1,
    borderColor: '#EAE6E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
});
