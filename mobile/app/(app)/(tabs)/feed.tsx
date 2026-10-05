import React, { useState, useCallback } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { MarketDigestModal } from '@/common/components/digest/MarketDigestModal';
import { DynamicCard } from '@/common/components/home/DynamicCard';
import PositionScreen from './position';

/**
 * 0.7 redesign Home — the dynamic card ("dynamic island") pinned at top,
 * collapsing on scroll, with live positions below. Dashboard / Contracts
 * moved to the Menu screen.
 */
export default function HomeScreen() {
  const { digest_date: digestDateParam } = useLocalSearchParams<{ digest_date?: string }>();
  const [digestModalDate, setDigestModalDate] = useState<string | null>(null);
  const scrollY = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const openBrief = useCallback(() => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setDigestModalDate(iso);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (digestDateParam) {
        setDigestModalDate(digestDateParam);
        router.setParams({ digest_date: undefined });
      }
    }, [digestDateParam]),
  );

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <DynamicCard scrollY={scrollY} onOpenBrief={openBrief} />
        <View style={{ marginTop: 14 }}>
          <PositionScreen embedded />
        </View>
      </Animated.ScrollView>
      <MarketDigestModal
        date={digestModalDate}
        visible={!!digestModalDate}
        onClose={() => setDigestModalDate(null)}
      />
    </View>
  );
}
