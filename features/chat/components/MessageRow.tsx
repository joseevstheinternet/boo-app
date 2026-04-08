import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

const { width: SW } = Dimensions.get('window');
import { AVATAR_W, ChatItem, Message, formatTime } from '../types';
import { useSearchTerm } from '../contexts/SearchContext';
import { ImageGrid } from './ImageGrid';

// ─── renderHighlightedText ────────────────────────────────────────────────────

export function renderHighlightedText(text: string, term: string | undefined, style: any) {
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

export function MessageRow({
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
  flatListRef: React.RefObject<FlatList | null>;
  onLongPress: (msg: Message, y: number, height: number) => void;
  setReplyTo: (m: Message | null) => void;
  setProfileModal: (m: { visible: boolean; name: string; image: string }) => void;
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
  prevUid: string;
  onImagePress?: (urls: string[], index: number) => void;
  searchTerm?: string;
}) {
  const contextTerm = useSearchTerm();
  const effectiveTerm = searchTerm ?? (contextTerm || undefined);

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
                  {hasTxt && renderHighlightedText(msg.text, effectiveTerm, s.bubbleMeTxt)}
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
                source={myAvatar ? { uri: myAvatar } : require('../../../assets/images/profile-default.png')}
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
                source={partnerAvatar ? { uri: partnerAvatar } : require('../../../assets/images/profile-default.png')}
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
                  {hasTxt && renderHighlightedText(msg.text, effectiveTerm, s.bubblePartnerTxt)}
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

const s = StyleSheet.create({
  avatar: {
    width: AVATAR_W, height: AVATAR_W,
    borderRadius: AVATAR_W / 2,
    backgroundColor: '#FAD0D8',
    overflow: 'hidden',
  },
  avatarSpacer: { width: AVATAR_W },

  rowLeft: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  timeLeft: {
    fontFamily: 'Pretendard-Regular', fontSize: 10,
    color: '#C4A0A8', alignSelf: 'flex-end', paddingBottom: 2,
  },

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

  reactionBadge: {
    position: 'absolute',
    flexDirection: 'row',
    backgroundColor: '#e2e2e2',
    borderRadius: 20,
    paddingHorizontal: 6, paddingVertical: 8,
    gap: 1,
  },
  reactionBadgeEmoji: { fontSize: 16 },
});
