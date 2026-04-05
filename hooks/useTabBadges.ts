import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { auth, db } from '../firebaseConfig';

export function useTabBadges() {
  const [feedCount, setFeedCount]     = useState(0);
  const [albumCount, setAlbumCount]   = useState(0);
  const [chatCount, setChatCount]     = useState(0);
  const [commentIds, setCommentIds]   = useState<string[]>([]); // postIds with unread comments

  useEffect(() => {
    let unsubFeed:     (() => void) | null = null;
    let unsubAlbum:    (() => void) | null = null;
    let unsubChat:     (() => void) | null = null;
    let unsubComments: (() => void) | null = null;

    async function setup() {
      const uid = auth.currentUser?.uid ?? (await AsyncStorage.getItem('userUid')) ?? '';
      const cid = (await AsyncStorage.getItem('coupleId')) ?? '';
      if (!uid || !cid) return;

      unsubFeed = onSnapshot(
        query(collection(db, 'couples', cid, 'posts'), where('confirmed', '==', false)),
        snap => setFeedCount(snap.docs.filter(d => d.data().authorId !== uid).length),
      );

      unsubAlbum = onSnapshot(
        query(collection(db, 'couples', cid, 'album'), where('confirmed', '==', false)),
        snap => setAlbumCount(snap.docs.filter(d => d.data().createdBy !== uid).length),
      );

      unsubChat = onSnapshot(
        query(collection(db, 'couples', cid, 'messages'), where('read', '==', false)),
        snap => setChatCount(snap.docs.filter(d => d.data().senderId !== uid).length),
      );

      // 내 글에 달린 읽지 않은 댓글 → 어느 postId에 새 댓글이 있는지 추적
      unsubComments = onSnapshot(
        query(
          collection(db, 'couples', cid, 'comments'),
          where('receiverId', '==', uid),
          where('read', '==', false),
        ),
        snap => {
          const ids = snap.docs
            .map(d => d.data().postId ?? '')
            .filter(Boolean);
          setCommentIds([...new Set(ids)]);
        },
      );
    }

    setup();
    return () => {
      unsubFeed?.();
      unsubAlbum?.();
      unsubChat?.();
      unsubComments?.();
    };
  }, []);

  return { feedCount, albumCount, chatCount, commentIds };
}
