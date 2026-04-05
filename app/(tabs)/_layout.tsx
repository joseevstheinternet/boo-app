import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { Tabs, router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBadges } from '../../hooks/useTabBadges';

const ICON_HOME  = require('../../assets/images/icon-home.png');
const ICON_FEED  = require('../../assets/images/icon-feed.png');
const ICON_CHAT  = require('../../assets/images/icon-chat.png');
const ICON_ALBUM = require('../../assets/images/icon-album.png');
const ICON_MORE  = require('../../assets/images/icon-more.png');

const LEFT_TABS  = ['home', 'feed']  as const;
const RIGHT_TABS = ['album', 'more'] as const;
const LEFT_ICONS  = [ICON_HOME, ICON_FEED];
const RIGHT_ICONS = [ICON_ALBUM, ICON_MORE];

// pill 내 탭 너비 = 65, paddingHorizontal 5 → 두 탭 65+65=130, 양쪽 5씩 패딩
const TAB_W = 65;
// pill 세로 중앙: (45 - 35) / 2 = 5
const SEL_TOP = 5;

function badgeLabel(n: number) {
  return n > 99 ? '99+' : String(n);
}

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets    = useSafeAreaInsets();
  const pathname  = usePathname();
  const { feedCount, albumCount, chatCount } = useTabBadges();

  // pathname 예: '/(tabs)/home' → 마지막 세그먼트 추출
  const activeRoute = pathname.split('/').pop() ?? '';

  // 어느 pill이 활성인지: 'left' | 'right' | null
  const leftActive  = activeRoute === 'home' || activeRoute === 'feed';
  const rightActive = activeRoute === 'album' || activeRoute === 'more';

  // translateX: 왼쪽 탭=0, 오른쪽 탭=TAB_W
  const leftSlide   = useRef(new Animated.Value(activeRoute === 'feed'  ? TAB_W : 0)).current;
  const rightSlide  = useRef(new Animated.Value(activeRoute === 'more'  ? TAB_W : 0)).current;
  // opacity: 활성 pill=1, 비활성 pill=0
  const leftOpacity  = useRef(new Animated.Value(leftActive  ? 1 : 0)).current;
  const rightOpacity = useRef(new Animated.Value(rightActive ? 1 : 0)).current;

  useEffect(() => {
    const spring = (val: Animated.Value, toValue: number) =>
      Animated.spring(val, { toValue, stiffness: 200, damping: 20, useNativeDriver: true });

    spring(leftSlide,   activeRoute === 'feed' ? TAB_W : 0).start();
    spring(rightSlide,  activeRoute === 'more' ? TAB_W : 0).start();
    spring(leftOpacity,  leftActive  ? 1 : 0).start();
    spring(rightOpacity, rightActive ? 1 : 0).start();
  }, [activeRoute]);

  const navigate = (name: string) => {
    const route = state.routes.find(r => r.name === name);
    if (!route) return;
    const focused = activeRoute === name;
    const event   = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(name);
  };

  // badges[i] 는 tabs[i]에 해당하는 배지 카운트
  const renderPill = (
    tabs: readonly string[],
    icons: typeof LEFT_ICONS,
    slide: Animated.Value,
    opacity: Animated.Value,
    badges: number[],
  ) => (
    <View style={s.pill}>
      {/* 슬라이딩 선택 배경 — translateX로 위치, opacity로 표시/숨김 */}
      <Animated.View
        style={[s.selBg, { opacity, transform: [{ translateX: slide }] }]}
        pointerEvents="none"
      />

      {/* 아이콘 탭 버튼들 — flex 고정 위치, zIndex로 selBg 위에 */}
      {tabs.map((name, i) => (
        <TouchableOpacity
          key={name}
          style={s.pillTab}
          onPress={() => navigate(name)}
          activeOpacity={0.8}
        >
          <Image source={icons[i]} style={s.icon} />
          {badges[i] > 0 && (
            <View style={[s.badge, s.badgePill]}>
              <Text style={s.badgeTxt}>{badgeLabel(badges[i])}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={[s.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
      <View style={s.row}>
        {renderPill(LEFT_TABS,  LEFT_ICONS,  leftSlide,  leftOpacity,  [0, feedCount])}

        <TouchableOpacity style={s.chatBtn} onPress={() => router.push('/chat')} activeOpacity={0.85}>
          <Image source={ICON_CHAT} style={[s.icon]} />
          {chatCount > 0 && (
            <View style={[s.badge, s.badgeChat]}>
              <Text style={s.badgeTxt}>{badgeLabel(chatCount)}</Text>
            </View>
          )}
        </TouchableOpacity>

        {renderPill(RIGHT_TABS, RIGHT_ICONS, rightSlide, rightOpacity, [albumCount, 0])}
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={props => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          position: 'absolute',
        },
        contentStyle: { paddingBottom: 90 },
      }}
      tabBarBackground={() => (
        <BlurView
          intensity={80}
          tint="light"
          style={StyleSheet.absoluteFill}
        />
      )}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="album" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#e3e3e484',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 92,
    justifyContent: 'flex-start',
    paddingTop: 12,
    overflow: 'visible',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  // pill: 140×45, paddingHorizontal:5 → 내부 130 = TAB_W(65)×2
  pill: {
    flexDirection: 'row',
    width: 140,
    height: 45,
    borderRadius: 40,
    backgroundColor: '#F9F9F9',
    alignItems: 'center',
    paddingHorizontal: 5,
    overflow: 'visible',  // 배지가 pill 밖으로 나올 수 있도록
  },
  // 선택 배경: pill 내부 absolute, top:5 으로 세로 중앙, left:5 에서 시작
  // translateX 0 = 왼쪽 탭, 65 = 오른쪽 탭
  selBg: {
    position: 'absolute',
    left: 5,
    top: SEL_TOP,
    width: TAB_W,
    height: 35,
    borderRadius: 40,
    backgroundColor: '#E3E3E4',
  },
  // 탭 버튼: 65×45, 아이콘 중앙 정렬, selBg 위에
  pillTab: {
    width: TAB_W,
    height: 45,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    overflow: 'visible',
  },
  icon: {
    width: 28,
    height: 28,
  },
  chatBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1D1D1D',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  badge: {
    position: 'absolute',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F17088',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgePill: {
    top: 4,
    left: 35,
  },
  badgeChat: {
    top: 0,
    right: 0,
  },
  badgeTxt: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 10,
    color: '#fff',
    lineHeight: 13,
  },
});
