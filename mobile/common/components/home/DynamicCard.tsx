import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  interpolate,
  Extrapolation,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { useThemeColors } from '@/lib/useColorScheme';
import { DynamicChartsView } from './views/DynamicChartsView';
import { ConfirmStackCard, usePendingConfirmations } from './cards/ConfirmStackCard';
import { SoldCard } from './cards/SoldCard';
import { useSoldTradeAlert } from './cards/useSoldTradeAlert';

/**
 * 0.7 redesign dynamic card ("dynamic island").
 *
 * - Collapses to a slim strip on scroll (driven by the parent's scrollY),
 *   expands back on scroll up — springy, like the reference video.
 * - Horizontal swipe between views: charts | signals | brief | contracts |
 *   news, with animated transitions.
 * - Transient states (confirm-entry stack, sold card) take over the card;
 *   see ConfirmStackCard / SoldCard.
 */

export const DYNAMIC_VIEWS = ['charts', 'signals', 'brief', 'contracts', 'news'] as const;
export type DynamicViewKey = (typeof DYNAMIC_VIEWS)[number];

export const EXPANDED_H = 380;
const COLLAPSED_H = 76;
const COLLAPSE_RANGE = 140;

export interface TickerInfo {
  ticker: string;
  price: number | null;
  changePct: number | null;
}

export function DynamicCard({
  scrollY,
  initialView = 'charts',
  onOpenBrief,
}: {
  scrollY: SharedValue<number>;
  initialView?: DynamicViewKey;
  onOpenBrief: () => void;
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const pageWidth = width - 28; // parent horizontal padding
  const [viewIndex, setViewIndex] = useState(() => Math.max(0, DYNAMIC_VIEWS.indexOf(initialView)));
  const [collapsed, setCollapsed] = useState(false);
  const [tickerInfo, setTickerInfo] = useState<TickerInfo>({ ticker: '', price: null, changePct: null });
  const pagerRef = useRef<FlatList<DynamicViewKey>>(null);

  // Transient states take over the card — sold (12s) beats the confirm
  // stack, which beats the swipe views. Both pin the card expanded.
  const { alert: soldAlert, dismiss: dismissSold } = useSoldTradeAlert();
  const pending = usePendingConfirmations();
  const transientActive = soldAlert != null || pending.length > 0;

  // Flip pointer-events + interactivity when the collapse crosses over.
  useAnimatedReaction(
    () => scrollY.value > COLLAPSE_RANGE * 0.7,
    (isCollapsed, prev) => {
      if (isCollapsed !== prev) runOnJS(setCollapsed)(isCollapsed);
    },
  );

  useEffect(() => {
    pagerRef.current?.scrollToIndex({ index: viewIndex, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    height: transientActive
      ? EXPANDED_H
      : interpolate(scrollY.value, [0, COLLAPSE_RANGE], [EXPANDED_H, COLLAPSED_H], Extrapolation.CLAMP),
  }));
  const expandedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE_RANGE * 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_RANGE * 0.4, COLLAPSE_RANGE], [0, 1], Extrapolation.CLAMP),
  }));

  const onViewableChanged = useCallback(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setViewIndex(i);
  }, []);

  const renderView = useCallback(
    ({ item }: { item: DynamicViewKey }) => {
      switch (item) {
        case 'charts':
          return <DynamicChartsView onActiveTicker={setTickerInfo} height={EXPANDED_H} />;
        default:
          return (
            <View style={[styles.page, { width: pageWidth, justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
                {item} view — coming in the next piece
              </Text>
            </View>
          );
      }
    },
    [pageWidth, colors],
  );

  const changeUp = (tickerInfo.changePct ?? 0) >= 0;

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.cardBorder },
        containerStyle,
      ]}
    >
      {soldAlert ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <SoldCard alert={soldAlert} onDismiss={dismissSold} />
        </ScrollView>
      ) : pending.length > 0 ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <ConfirmStackCard />
        </ScrollView>
      ) : (
        <>
          {/* expanded: horizontal view pager */}
          <Animated.View style={[StyleSheet.absoluteFillObject, expandedStyle]} pointerEvents={collapsed ? 'none' : 'auto'}>
            <FlatList
              ref={pagerRef}
              data={DYNAMIC_VIEWS as unknown as DynamicViewKey[]}
              keyExtractor={(k) => k}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              renderItem={renderView}
              onViewableItemsChanged={onViewableChanged}
              viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
              getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
            />
            {/* view dots */}
            <View style={styles.dots}>
              {DYNAMIC_VIEWS.map((v, i) => (
                <View
                  key={v}
                  style={[
                    styles.dot,
                    { backgroundColor: i === viewIndex ? colors.text : colors.textTertiary + '55' },
                  ]}
                />
              ))}
            </View>
          </Animated.View>

          {/* collapsed strip */}
          <Animated.View
            style={[StyleSheet.absoluteFillObject, collapsedStyle, styles.collapsedRow]}
            pointerEvents={collapsed ? 'auto' : 'none'}
          >
            <Text style={[styles.mono, { fontSize: 14, fontWeight: '800', color: colors.text }]}>
              {tickerInfo.ticker || '—'}
            </Text>
            {tickerInfo.price != null && (
              <Text style={[styles.mono, { fontSize: 14, color: colors.textSecondary }]}>
                ${tickerInfo.price.toFixed(2)}
              </Text>
            )}
            {tickerInfo.changePct != null && (
              <Text
                style={[
                  styles.mono,
                  { fontSize: 12, fontWeight: '700', color: changeUp ? colors.success : colors.error },
                ]}
              >
                {changeUp ? '+' : ''}{tickerInfo.changePct.toFixed(2)}%
              </Text>
            )}
            <View style={{ flex: 1 }} />
            <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
              {DYNAMIC_VIEWS[viewIndex].toUpperCase()}
            </Text>
          </Animated.View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    marginHorizontal: 14,
  },
  mono: { fontFamily: 'Menlo' },
  page: {
    padding: 14,
  },
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
});
