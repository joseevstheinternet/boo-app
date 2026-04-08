import { Ionicons } from '@expo/vector-icons';
import {
  Timestamp,
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where
} from 'firebase/firestore';
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
import { db } from '../../../firebaseConfig';
import { HEADER_H, Message } from '../types';

const { height: SH } = Dimensions.get('window');

const GRASS_COLORS_MODAL = ['#F0ECE8','#E8C5C8','#DD9DA7','#D37787','#C95369','#BF2E49'];
const MONTH_KR_MODAL = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const CELL_MODAL = 18;
const GAP_MODAL = 2;
const WEEK_W_MODAL = CELL_MODAL + GAP_MODAL;

function grassLevelModal(n: number) {
  if (n === 0) return 0; if (n < 100) return 1; if (n < 300) return 2;
  if (n < 500) return 3; if (n < 1000) return 4; return 5;
}

function tooltipMsgModal(count: number) {
  if (count === 0) return '대화 없음';
  if (count < 100) return '짧게 나눴어요';
  if (count < 300) return '꽤 많이 했네요 ☺️';
  if (count < 500) return '수다쟁이들 💬';
  if (count < 1000) return '종일 붙어 있었네요 🥰';
  return '오늘 무슨 일 있었어요? ❤️‍🔥';
}

export function ChatGrassModal({ visible, onClose, coupleId, onViewDate }: { visible: boolean; onClose: () => void; coupleId: string; onViewDate: (dateStr: string, messages: Message[]) => void }) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SH)).current;
  const [mounted, setMounted] = useState(false);
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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
      setSelectedDate(null);
      Animated.spring(slideAnim, { toValue: 0, stiffness: 300, damping: 30, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SH, duration: 250, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !coupleId) return;
    const unsub = onSnapshot(
      collection(db, 'couples', coupleId, 'daily'),
      (snap: any) => {
        const counts: Record<string, number> = {};
        snap.forEach((d: any) => { counts[d.id] = d.data().count ?? 0; });
        setDailyCounts(counts);
      }
    );
    return () => unsub();
  }, [visible, coupleId]);

  function toKeyModal(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function buildModalGrid() {
    const today = new Date(); today.setHours(0,0,0,0);

    const keys = Object.keys(dailyCounts).filter(k => dailyCounts[k] > 0).sort();

    let firstSun: Date;
    if (keys.length > 0) {
      const oldest = new Date(keys[0] + 'T00:00:00');
      oldest.setHours(0,0,0,0);
      firstSun = new Date(oldest);
      firstSun.setDate(oldest.getDate() - oldest.getDay());
    } else {
      const ago = new Date(today);
      ago.setDate(today.getDate() - 13 * 7);
      firstSun = new Date(ago);
      firstSun.setDate(ago.getDate() - ago.getDay());
    }

    const todaySun = new Date(today);
    todaySun.setDate(today.getDate() - today.getDay());

    const weeks: { date: Date; isToday: boolean; isFuture: boolean }[][] = [];
    const cur = new Date(firstSun);
    while (cur <= todaySun) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(cur); day.setDate(cur.getDate() + d);
        week.push({ date: day, isToday: day.getTime() === today.getTime(), isFuture: day.getTime() > today.getTime() });
      }
      weeks.push(week);
      cur.setDate(cur.getDate() + 7);
    }

    const monthLabels: (string | null)[] = [];
    let lastMonth = -1;
    weeks.forEach(w => {
      const m = w[0].date.getMonth();
      monthLabels.push(m !== lastMonth ? MONTH_KR_MODAL[m] : null);
      lastMonth = m;
    });

    return { weeks, monthLabels };
  }

  const { weeks, monthLabels } = buildModalGrid();
  const CHUNK = 17;
  const chunks: typeof weeks[] = [];
  for (let i = 0; i < weeks.length; i += CHUNK) chunks.push(weeks.slice(i, i + CHUNK));

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
            <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 17, color: '#2D1B1E' }}>{'대화 잔디'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color="#2D1B1E" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, alignItems: 'center' }}>
          {chunks.map((chunk, ci) => {
            const chunkMonthLabels = monthLabels.slice(ci * CHUNK, ci * CHUNK + CHUNK);
            return (
              <View key={ci} style={{ marginBottom: 24, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', height: 16, marginBottom: 4 }}>
                  {chunkMonthLabels.map((lbl, wi) => (
                    <View key={wi} style={{ width: WEEK_W_MODAL }}>
                      {lbl && <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 9, color: '#9B8B8E' }}>{lbl}</Text>}
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: GAP_MODAL }}>
                  {chunk.map((week, wi) => (
                    <View key={wi} style={{ flexDirection: 'column', gap: GAP_MODAL }}>
                      {week.map((day, di) => {
                        if (day.isFuture) return <View key={di} style={{ width: CELL_MODAL, height: CELL_MODAL }} />;
                        const ds = toKeyModal(day.date);
                        const cnt = dailyCounts[ds] ?? 0;
                        const lv = grassLevelModal(cnt);
                        return (
                          <TouchableOpacity
                            key={di}
                            style={[
                              { width: CELL_MODAL, height: CELL_MODAL, borderRadius: 4, backgroundColor: GRASS_COLORS_MODAL[lv] },
                              day.isToday && { borderWidth: 2, borderColor: '#F17088' },
                              selectedDate === ds && !day.isToday && { borderWidth: 2, borderColor: '#2D1B1E' },
                            ]}
                            onPress={() => setSelectedDate(ds)}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          </ScrollView>

          {selectedDate && (() => {
            const d = new Date(selectedDate + 'T00:00:00');
            const cnt = dailyCounts[selectedDate] ?? 0;
            return (
              <View style={{
                position: 'absolute',
                bottom: insets.bottom + 16,
                left: 16, right: 16,
                backgroundColor: '#2D1B1E',
                borderRadius: 16,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.2,
                shadowRadius: 12,
                elevation: 8,
              }}>
                <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: GRASS_COLORS_MODAL[grassLevelModal(cnt)] }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, color: '#fff' }}>
                    {d.getFullYear()}년 {d.getMonth()+1}월 {d.getDate()}일
                  </Text>
                  <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                    {cnt.toLocaleString()}개 · {tooltipMsgModal(cnt)}
                  </Text>
                </View>
                {cnt > 0 && (
                  <TouchableOpacity
                    style={{ backgroundColor: '#F17088', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}
                    onPress={async () => {
                      if (!selectedDate) return;
                      try {
                        const targetDate = new Date(selectedDate + 'T00:00:00');
                        const nextDate = new Date(targetDate); nextDate.setDate(targetDate.getDate() + 1);
                        const snap = await getDocs(query(
                          collection(db, 'couples', coupleId, 'messages'),
                          where('createdAt', '>=', Timestamp.fromDate(targetDate)),
                          where('createdAt', '<', Timestamp.fromDate(nextDate)),
                          orderBy('createdAt', 'asc')
                        ));
                        const msgs: Message[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Message));
                        if (msgs.length === 0) {
                          Alert.alert('대화 없음', '해당 날짜에 대화가 없어요.');
                          return;
                        }
                        onViewDate(selectedDate, msgs);
                      } catch (e) {
                        Alert.alert('오류', '대화를 불러오는데 실패했어요.');
                      }
                    }}
                  >
                    <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, color: '#fff' }}>이 날로 이동</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}
        </View>
      </Animated.View>
    </Modal>
  );
}
