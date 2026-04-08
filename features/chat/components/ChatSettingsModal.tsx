import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HEADER_H } from '../types';

const { width: SW, height: SH } = Dimensions.get('window');

export function ChatSettingsModal({ visible, onClose, onBgChange, photoQuality, onQualityChange }: {
  visible: boolean;
  onClose: () => void;
  onBgChange: (uri: string) => void | Promise<void>;
  photoQuality: 'low' | 'normal' | 'high';
  onQualityChange: (q: 'low' | 'normal' | 'high') => void;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SH)).current;
  const [mounted, setMounted] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;

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
      setMounted(true);
      slideAnim.setValue(SH);
      translateX.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible]);

  const qualityOptions: { key: 'low' | 'normal' | 'high'; label: string; desc: string }[] = [
    { key: 'low', label: '저화질', desc: '빠르게 전송돼요' },
    { key: 'normal', label: '일반화질', desc: '기본 설정' },
    { key: 'high', label: '고화질', desc: '업로드에 시간이 걸릴 수 있어요' },
  ];

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
            style={{
              height: HEADER_H, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#F0EEEC',
            }}
            {...panResponder.panHandlers}
          >
            <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 17, color: '#2D1B1E' }}>{'설정'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color="#2D1B1E" />
            </TouchableOpacity>
          </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#9B8B8E', marginBottom: 12 }}>배경</Text>
            <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#F0EEEC' }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#F0EEEC' }}
                onPress={() => Alert.alert('추후 공개', '기본 배경 선택은 추후 업데이트될 예정이에요.')}
              >
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E' }}>기본 배경 선택</Text>
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#C4A0A8' }}>추후 공개 →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}
                onPress={() => Alert.alert('임시 비활성화', '현재 업데이트 중이에요.')}
              >
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E' }}>앨범에서 선택</Text>
                <Ionicons name="chevron-forward" size={16} color="#C4A0A8" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#9B8B8E', marginBottom: 12 }}>사진 전송 품질</Text>
            <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#F0EEEC' }}>
              {qualityOptions.map((opt, i) => (
                <TouchableOpacity
                  key={opt.key}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    padding: 16,
                    borderBottomWidth: i < qualityOptions.length - 1 ? 1 : 0,
                    borderColor: '#F0EEEC',
                    backgroundColor: photoQuality === opt.key ? '#FFF5F7' : '#fff',
                  }}
                  onPress={() => onQualityChange(opt.key)}
                >
                  <View>
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, color: '#2D1B1E' }}>{opt.label}</Text>
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#9B8B8E', marginTop: 2 }}>{opt.desc}</Text>
                  </View>
                  {photoQuality === opt.key && <Ionicons name="checkmark" size={18} color="#F17088" />}
                </TouchableOpacity>
              ))}
            </View>
            {photoQuality === 'high' && (
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#F17088', marginTop: 8, paddingHorizontal: 4 }}>
                고화질 전송은 업로드 및 로딩에 시간이 소요될 수 있어요.
              </Text>
            )}
          </View>
        </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}
