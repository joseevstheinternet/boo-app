import { useRef } from 'react';
import {
  Animated,
  StyleSheet,
  TouchableOpacity,
  View
} from 'react-native';
import { IMG_CELL, IMG_GAP, IMG_SINGLE } from '../types';

// ─── ChatImage ────────────────────────────────────────────────────────────────

export function ChatImage({ uri, style }: { uri: string; style: object }) {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <View style={[style, { backgroundColor: 'transparent', overflow: 'hidden' }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#E8E8E8' }]} />
      <Animated.Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
        onLoad={() =>
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
        }
      />
    </View>
  );
}

// ─── ImageGrid ────────────────────────────────────────────────────────────────

export function ImageGrid({ urls, onImagePress }: { urls: string[]; onImagePress?: (index: number) => void }) {
  if (urls.length === 1) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(0)}>
        <ChatImage uri={urls[0]} style={{ width: IMG_SINGLE, height: IMG_SINGLE }} />
      </TouchableOpacity>
    );
  }
  if (urls.length === 2) {
    return (
      <View style={{ flexDirection: 'row', gap: IMG_GAP }}>
        {urls.map((u, i) => (
          <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => onImagePress?.(i)}>
            <ChatImage uri={u} style={{ width: IMG_CELL, height: IMG_CELL }} />
          </TouchableOpacity>
        ))}
      </View>
    );
  }
  if (urls.length === 3) {
    return (
      <View style={{ gap: IMG_GAP }}>
        <View style={{ flexDirection: 'row', gap: IMG_GAP }}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(0)}>
            <ChatImage uri={urls[0]} style={{ width: IMG_CELL, height: IMG_CELL }} />
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(1)}>
            <ChatImage uri={urls[1]} style={{ width: IMG_CELL, height: IMG_CELL }} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(2)}>
          <ChatImage uri={urls[2]} style={{ width: IMG_CELL * 2 + IMG_GAP, height: IMG_CELL }} />
        </TouchableOpacity>
      </View>
    );
  }
  // 4+: 2열 그리드
  const rows: string[][] = [];
  for (let i = 0; i < urls.length; i += 2) rows.push(urls.slice(i, i + 2));
  return (
    <View style={{ gap: IMG_GAP }}>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: IMG_GAP }}>
          {row.map((u, ci) => (
            <TouchableOpacity key={ci} activeOpacity={0.9} onPress={() => onImagePress?.(ri * 2 + ci)}>
              <ChatImage uri={u} style={{ width: IMG_CELL, height: IMG_CELL }} />
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </View>
  );
}
