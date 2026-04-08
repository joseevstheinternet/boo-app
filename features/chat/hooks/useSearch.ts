import {
  Timestamp,
  collection,
  getDocs,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { useRef, useState } from 'react';
import { Keyboard, TextInput } from 'react-native';
import { db } from '../../../firebaseConfig';
import { Message, toDateStr } from '../types';

export function useSearch(coupleId: string) {
  const [searchActive, setSearchActive]       = useState(false);
  const [searchQuery, setSearchQuery]         = useState('');
  const [searchResults, setSearchResults]     = useState<Message[]>([]);
  const [searchLoading, setSearchLoading]     = useState(false);
  const [allMessages, setAllMessages]         = useState<Message[]>([]);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);

  function activate() {
    setSearchActive(true);
    setSearchQuery('');
    setSearchResults([]);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }

  function deactivate() {
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

  async function handleSearchResultPress(
    msg: Message,
    setDateChatModal: (v: { visible: boolean; dateStr: string; messages: Message[]; fromGrass?: boolean; targetMessageId?: string; searchTerm?: string }) => void,
  ) {
    if (!msg.createdAt) return;
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

  return {
    searchActive,
    searchQuery,
    searchResults,
    searchLoading,
    allMessagesLoaded,
    searchInputRef,
    activate,
    deactivate,
    handleSearchChange,
    submitSearch,
    handleSearchResultPress,
  };
}
