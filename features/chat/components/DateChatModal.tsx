import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchContext } from '../contexts/SearchContext';
import { HEADER_H, Message, buildChatItems } from '../types';
import { MessageRow } from './MessageRow';

const { height: SH } = Dimensions.get('window');

export function DateChatModal({
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
    <SearchContext.Provider value={{ term: searchTerm ?? '' }}>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: '#F0EEEC' }} />
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 11, color: '#C4A0A8' }}>{item.label}</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: '#F0EEEC' }} />
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
                />
              );
            }}
          />
        </Animated.View>
      </Modal>
    </SearchContext.Provider>
  );
}
