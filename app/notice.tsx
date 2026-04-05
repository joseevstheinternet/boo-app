import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const UPDATES = [
  {
    version: '1.0.0',
    date: '2026년',
    items: [
      '처음 만났어요! buny가 시작됐어요',
      '채팅, 피드, 앨범, 홈 화면이 생겼어요',
      '책이랑 영화도 함께 기록할 수 있어요',
      '답장, 리액션 기능이 생겼어요',
    ],
  },
];

export default function NoticeScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      {/* 헤더 */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.backBtn}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>공지사항</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

        {/* 커피 섹션 -> 정식 출시 시 표시 */}
        {/* <TouchableOpacity
          style={s.coffeeCard}
          onPress={() => Linking.openURL('https://buymeacoffee.com')}
          activeOpacity={0.85}
        >
          <Ionicons name="cafe-outline" size={24} color="#C8A06A" />
          <View style={{ flex: 1 }}>
            <Text style={s.coffeeTitle}>개발자에게 커피 한 잔</Text>
            <Text style={s.coffeeDesc}>서버비에 여러분의 도움이 필요해요</Text>
          </View>
          <Text style={s.coffeeChevron}>›</Text>
        </TouchableOpacity> */}

        {/* 의견 보내기 */}
        <TouchableOpacity
          style={s.feedbackCard}
          onPress={() => Linking.openURL('https://forms.gle/PuR6FpLtcPnMcJks8')}
          activeOpacity={0.85}
        >
          <Ionicons name="mail-outline" size={24} color="#F17088" />
          <View style={{ flex: 1 }}>
            <Text style={s.feedbackTitle}>의견 보내기</Text>
            <Text style={s.feedbackDesc}>불편한 점이나 원하는 기능을 알려주세요</Text>
          </View>
          <Text style={s.coffeeChevron}>›</Text>
        </TouchableOpacity>

        {/* 업데이트 노트 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>업데이트 노트</Text>
          {UPDATES.map((update) => (
            <View key={update.version} style={s.updateCard}>
              <View style={s.updateHeader}>
                <Text style={s.updateVersion}>v{update.version}</Text>
                <Text style={s.updateDate}>{update.date}</Text>
              </View>
              {update.items.map((item, i) => (
                <View key={i} style={s.updateRow}>
                  <Text style={s.updateDot}>·</Text>
                  <Text style={s.updateItem}>{item}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* 개인정보 처리방침 */}
        <TouchableOpacity
          style={s.privacyBtn}
          onPress={() => Linking.openURL('https://buny-app.notion.site/?pvs=143')}
          activeOpacity={0.7}
        >
          <Text style={s.privacyTxt}>개인정보 처리방침</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#F0EAEB',
    backgroundColor: '#FAFAFA',
  },
  backBtn: { fontSize: 28, color: '#2D1B1E', lineHeight: 32 },
  headerTitle: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 16,
    color: '#2D1B1E',
  },

  coffeeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#FFF8F0',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFE0B2',
    padding: 18,
  },
  coffeeEmoji: { fontSize: 28 },
  coffeeTitle: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#2D1B1E',
    marginBottom: 3,
  },
  coffeeDesc: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#9B8B8E',
  },
  coffeeChevron: { fontSize: 20, color: '#C4A0A8', lineHeight: 24 },

  feedbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#FFF0F3',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F9C0CB',
    padding: 18,
  },
  feedbackEmoji: { fontSize: 28 },
  feedbackTitle: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 15,
    color: '#2D1B1E',
    marginBottom: 3,
  },
  feedbackDesc: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#9B8B8E',
  },

  section: { marginHorizontal: 20, marginTop: 24 },
  sectionTitle: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize: 12,
    color: '#9B8B8E',
    marginBottom: 10,
    letterSpacing: 0.4,
  },

  updateCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAE6E1',
    padding: 18,
    marginBottom: 12,
  },
  updateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  updateVersion: {
    fontFamily: 'Pretendard-Bold',
    fontSize: 15,
    color: '#F17088',
  },
  updateDate: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#B0A0A4',
  },
  updateRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  updateDot: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#F17088',
    lineHeight: 22,
  },
  updateItem: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 14,
    color: '#2D1B1E',
    lineHeight: 22,
    flex: 1,
  },

  privacyBtn: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  privacyTxt: {
    fontFamily: 'Pretendard-Regular',
    fontSize: 12,
    color: '#C4A0A8',
    textDecorationLine: 'underline',
  },
});
