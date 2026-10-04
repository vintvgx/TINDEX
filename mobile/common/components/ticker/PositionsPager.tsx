import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions, LayoutChangeEvent } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { PositionRow } from '@/common/components/strategy/LivePositionsSection';
import type { UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';

/**
 * PositionsPager — docked open-positions panel for the Charts tab.
 * One position card per page, swipe left/right to paginate, dots show
 * where you are. No ticker / LIVE-PAPER header — the pager is already
 * scoped to the ticker on screen, so that row was wasted space. The panel has a
 * fixed height sized for exactly one card; it docks between the toolbar
 * and the tab bar, pushing the chart up (the chart keeps its min-height
 * guard and shrinks via flex).
 */
export function PositionsPager({
  data,
  ticker,
  onLiveUpdate,
  onPageChange,
}: {
  data: UseLivePositionsDataResult;
  ticker: string;
  onLiveUpdate: (strategyId: string, data: LivePriceData | null) => void;
  onPageChange?: (index: number) => void;
}) {
  const colors = useThemeColors();
  const [index, setIndex] = useState(0);
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
  const listRef = useRef<FlatList>(null);

  const positions = data.displayedPositions;

  // Reset to the first card when the ticker (or list) changes.
  useEffect(() => {
    setIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [ticker, positions.length]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - pageWidth) > 1) setPageWidth(w);
  };

  if (!positions.length) {
    return (
      <View style={[s.panel, { backgroundColor: colors.background, borderTopColor: colors.separator }]}>
        <View style={s.empty}>
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Open Positions</Text>
          <Text style={[s.emptySub, { color: colors.textSecondary }]}>
            Open {ticker} positions will appear here.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[s.panel, { backgroundColor: colors.background, borderTopColor: colors.separator }]}
      onLayout={onLayout}
    >
      <FlatList
        ref={listRef}
        data={positions}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        keyExtractor={(p) => p.strategy_id}
        getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
          setIndex(i);
          onPageChange?.(i);
        }}
        renderItem={({ item: pos }) => (
          <View style={[s.page, { width: pageWidth }]}>
            <PositionRow
              pos={pos}
              colors={colors}
              onLiveUpdate={onLiveUpdate}
              hideChartButton
              hideTicker
            />
          </View>
        )}
      />
      {positions.length > 1 ? (
        <View style={s.dots}>
          {positions.map((p, i) => (
            <View
              key={p.strategy_id}
              style={[
                s.dot,
                { backgroundColor: i === index ? colors.accent : colors.separator },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    // One card + dots; was 264 with the LIVE/PAPER badge row, 236 before
    // the card's grace/floor lines merged into its Qty meta row.
    height: 218,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  page: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700' },
  emptySub: { fontSize: 12 },
});
