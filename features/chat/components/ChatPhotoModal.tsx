import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Timestamp } from 'firebase/firestore';
import { HEADER_H, Message } from '../types';

const { width: SW, height: SH } = Dimensions.get('window');

export function ChatPhotoModal({
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
