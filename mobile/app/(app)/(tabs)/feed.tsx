import React, { useState, useCallback } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { MarketDigestModal } from '@/common/components/digest/MarketDigestModal';
import { DynamicCard, EXPANDED_H, COLLAPSE_RANGE } from '@/common/components/home/DynamicCard';
import PositionScreen from './position';
import { useThemeColors } from '@/lib/useColorScheme';
import { useWheelTabBarHeight } from '@/common/components/ui/WheelTabBar';

/**
 * 0.7 redesign Home — the dynamic card ("dynamic island") pinned at top,
 * collapsing on scroll, with live positions below. Dashboard / Contracts
 * moved to the Menu screen.
 */
// Space between the header above and the dynamic card.
const CARD_TOP_GAP = 10;
// Gap between the (expanded) card and the positions below it.
const CARD_BOTTOM_GAP = 14;

export default function HomeScreen() {
  const { digest_date: digestDateParam } = useLocalSearchParams<{ digest_date?: string }>();
  const [digestModalDate, setDigestModalDate] = useState<string | null>(null);
  const colors = useThemeColors();
  // The floating tab bar covers the bottom of the list — clear it (+ a gap).
  const tabBarClearance = useWheelTabBarHeight() + 12;
  const scrollY = useSharedValue(0);
  const [viewportH, setViewportH] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setViewportH(e.nativeEvent.layout.height), []);

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
    <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={onLayout}>
      {/* The card is an overlay ABOVE the ScrollView, not a (sticky) child:
          its height animates with scroll, and as a child that changed the
          content height mid-scroll → scrollY fed back into itself → jitter,
          and with little content (one position) the scrollable range kept
          vanishing → bounce. The content instead reserves the expanded
          card's height and always has room to scroll the full collapse
          range; snap points settle it fully open or fully collapsed. */}
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: CARD_TOP_GAP + EXPANDED_H + CARD_BOTTOM_GAP,
          paddingBottom: tabBarClearance,
          minHeight: viewportH > 0 ? viewportH + COLLAPSE_RANGE : undefined,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToOffsets={[0, COLLAPSE_RANGE]}
        snapToEnd={false}
      >
        <PositionScreen embedded />
      </Animated.ScrollView>
      {/* Page-colored backing from the header down through the card, so
          content scrolling under the collapsed card never peeks through
          the gap above it. */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: CARD_TOP_GAP, backgroundColor: colors.background }}
        pointerEvents="box-none"
      >
        <DynamicCard scrollY={scrollY} onOpenBrief={openBrief} />
      </View>
      <MarketDigestModal
        date={digestModalDate}
        visible={!!digestModalDate}
        onClose={() => setDigestModalDate(null)}
      />
    </View>
  );
}
