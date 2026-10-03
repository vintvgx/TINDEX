import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions, LayoutChangeEvent } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { PositionRow } from '@/common/components/strategy/LivePositionsSection';
import type { UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';

/**
 * PositionsPager — docked open-positions panel for the Charts tab.
 * One position card per page, swipe left/right to paginate, dots show
 * where you are. Each card carries a LIVE / PAPER badge. The panel has a
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
            {/* LIVE / PAPER badge — same convention as the tape's sell statuses */}
            <View style={s.badgeRow}>
              <View style={[s.badge, { backgroundColor: pos.paper_mode ? '#FF9F0A' : colors.error }]}>
                <Text style={s.badgeText}>{pos.paper_mode ? 'PAPER' : 'LIVE'}</Text>
              </View>
              {positions.length > 1 ? (
                <Text style={[s.counter, { color: colors.textTertiary }]}>
                  {index + 1} / {positions.length}
                </Text>
              ) : null}
            </View>
            <PositionRow
              pos={pos}
              colors={colors}
              onLiveUpdate={onLiveUpdate}
              hideChartButton
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
    height: 264,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  page: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  counter: {
    fontSize: 11,
    fontWeight: '600',
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
