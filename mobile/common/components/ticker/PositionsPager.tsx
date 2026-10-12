import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions, LayoutChangeEvent, ScrollView, useWindowDimensions } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { PositionRow } from '@/common/components/strategy/LivePositionsSection';
import type { UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';

/**
 * PositionsPager — docked open-positions panel for the Charts tab.
 * One position card per page, swipe left/right to paginate, dots show
 * where you are. No ticker / LIVE-PAPER header — the pager is already
 * scoped to the ticker on screen, so that row was wasted space. It docks
 * between the toolbar and the tab bar, pushing the chart up (the chart keeps
 * its min-height guard and shrinks via flex).
 *
 * Height follows the visible card's real content (measured), so extras like
 * the working-limit-orders list are never clipped — it used to be a fixed
 * 234pt sized for a bare card. Capped at MAX_FRACTION of the screen; a taller
 * card scrolls inside its page.
 */
const MIN_PANEL_H = 150;
const MAX_FRACTION = 0.55;
const DOTS_H = 16;
/** Scroll room under each card, deliberately NOT counted in the panel
 *  height: with the panel sized to the card exactly, the content barely
 *  overflowed, so a scroll down rubber-banded straight back up and the last
 *  rows (working limit orders) stayed tucked under the dots / tab bar. */
const SCROLL_TAIL = 75;
export function PositionsPager({
  data,
  ticker,
  onLiveUpdate,
  onPageChange,
  initialIndex = 0,
}: {
  data: UseLivePositionsDataResult;
  ticker: string;
  onLiveUpdate: (strategyId: string, data: LivePriceData | null) => void;
  onPageChange?: (index: number) => void;
  /** Page to open on — the chart strip passes the strip it was expanded from. */
  initialIndex?: number;
}) {
  const colors = useThemeColors();
  const { height: screenH } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  // Measured content height per position (by strategy_id).
  const [contentH, setContentH] = useState<Record<string, number>>({});
  const onContentLayout = (id: string) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setContentH((prev) => (Math.abs((prev[id] ?? 0) - h) < 2 ? prev : { ...prev, [id]: h }));
  };
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
  const listRef = useRef<FlatList>(null);

  const positions = data.displayedPositions;

  // Reset to the first card when the ticker (or list) changes.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
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

  const current = positions[Math.min(index, positions.length - 1)];
  const measured = current ? contentH[current.strategy_id] : undefined;
  const dotsH = positions.length > 1 ? DOTS_H : 0;
  const panelH = measured != null
    ? Math.max(MIN_PANEL_H, Math.min(measured + dotsH + 8, Math.round(screenH * MAX_FRACTION)))
    : 234; // first frame, before the card has been measured

  return (
    <View
      style={[s.panel, { height: panelH, backgroundColor: colors.background, borderTopColor: colors.separator }]}
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
        initialScrollIndex={Math.min(initialIndex, Math.max(0, positions.length - 1))}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
          setIndex(i);
          onPageChange?.(i);
        }}
        renderItem={({ item: pos }) => (
          <ScrollView
            style={{ width: pageWidth }}
            contentContainerStyle={{ paddingBottom: SCROLL_TAIL }}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <View style={s.page} onLayout={onContentLayout(pos.strategy_id)}>
              <PositionRow
                pos={pos}
                colors={colors}
                onLiveUpdate={onLiveUpdate}
                hideChartButton
                hideTicker
              />
            </View>
          </ScrollView>
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
    // Height is set inline from the measured card (see panelH).
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
