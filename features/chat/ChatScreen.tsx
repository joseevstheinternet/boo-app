import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePartnerProfile } from '../../contexts/PartnerProfileContext';
import { useProfile } from '../../contexts/ProfileContext';
import { db } from '../../firebaseConfig';
import { ChatPhotoModal } from './components/ChatPhotoModal';
import { ChatGrassModal } from './components/ChatGrassModal';
import { ChatSettingsModal } from './components/ChatSettingsModal';
import { DateChatModal } from './components/DateChatModal';
import { ImageViewerModal } from './components/ImageViewerModal';
import { MessageRow } from './components/MessageRow';
import { useChat } from './hooks/useChat';
import { useSearch } from './hooks/useSearch';
import { HEADER_H, Message, formatTime, toDateStr } from './types';

const { width: SW, height: SH } = Dimensions.get('window');

export default function ChatScreen() {
  const insets = useSafeAreaInsets();

  const {
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
  } = useChat();

  const {
    searchActive,
    searchQuery,
    searchResults,
    searchLoading,
    allMessagesLoaded,
    searchInputRef,
    activate: activateSearch,
    deactivate: deactivateSearch,
    handleSearchChange,
    submitSearch,
    handleSearchResultPress,
  } = useSearch(coupleId);

  const { nickname: myNick, profileImage: myAvatar, isReady: profileReady } = useProfile();
  const { nickname: partnerNick, profileImage: partnerAvatar, isReady: partnerReady } = usePartnerProfile();

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

  const moreMenuAnim = useState(() => new Animated.Value(0))[0];

  // ── chatBg 초기 로드 ──────────────────────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem('chatBg').then(savedBg => {
      if (savedBg) setChatBg(savedBg);
    });
  }, []);

  // ── 키보드 상태 ──────────────────────────────────────────────────────────

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvent, () => setKeyboardShown(true));
    const h = Keyboard.addListener(hideEvent, () => setKeyboardShown(false));
    return () => { s.remove(); h.remove(); };
  }, []);

  // ── 더보기 메뉴 ──────────────────────────────────────────────────────────

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

  // ── 렌더 ─────────────────────────────────────────────────────────────────

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
              source={require('../../assets/images/logo.png')}
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
                    onPress={() => handleSearchResultPress(item, setDateChatModal)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={
                        isMe
                          ? (myAvatar ? { uri: myAvatar } : require('../../assets/images/profile-default.png'))
                          : (partnerAvatar ? { uri: partnerAvatar } : require('../../assets/images/profile-default.png'))
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
            <Image source={require('../../assets/images/icon-chat.png')} style={{ width: 48, height: 48, marginBottom: 12 }} contentFit="contain" />
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
                <TouchableOpacity style={s.previewAddBtn} onPress={() => handlePickImage(setPendingImages)}>
                  <Ionicons name="add" size={28} color="#9B8B8E" />
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[s.previewSendBtn, uploading && { opacity: 0.6 }]}
              onPress={() => handleSendImages(pendingImages, uploading, setPendingImages, setUploading)}
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
              onPress={() => handlePickImage(setPendingImages)}
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
                onPress={() => handleSend(inputText, replyTo, sending, setInputText, setReplyTo, setSending)}
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
              { icon: 'search-outline', label: '검색', onPress: () => { setShowMoreMenu(false); moreMenuAnim.setValue(0); activateSearch(); } },
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
                : require('../../assets/images/profile-default.png')}
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
