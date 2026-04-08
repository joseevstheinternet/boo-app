import { Ionicons } from '@expo/vector-icons';
import { cacheDirectory, downloadAsync as fsDownloadAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

const { width: SW, height: SH } = Dimensions.get('window');

export function ImageViewerModal({
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
