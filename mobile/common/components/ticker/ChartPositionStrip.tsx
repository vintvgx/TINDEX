import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Animated, LayoutAnimation, type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useStrategyLivePrice, type LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import type { UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import { PositionsPager } from './PositionsPager';
import { LiveAccountStrip } from './LiveAccountStrip';

/**
 * Chart bottom slot, position-aware (chart position strip, 2026-10-11):
 *
 *   no open position for the ticker → the account readout, untouched and
 *                                     not tappable
 *   ≥1 position, collapsed          → compact strip(s), horizontal pager
 *   expanded                        → the existing full position cards
 *                                     (PositionsPager), grown in place
 *
 * `expanded` is owned by the chart so the toolbar's positions button and a
 * strip tap drive the same state. Closing the expanded position (or the
 * last one) collapses back; a newly opened position pulses the strip in.
 */
export function ChartPositionStrip({
  data, ticker, expanded, onExpandedChange, onLiveUpdate, bottomInset,
}: {
  data: UseLivePositionsDataResult;
  ticker: string;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  onLiveUpdate: (strategyId: string, d: LivePriceData | null) => void;
  bottomInset: number;
}) {
  const colors = useThemeColors();
  const positions = data.displayedPositions;
  const count = positions.length;
  const [index, setIndex] = useState(0);

  const pulse = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(count);
  const prevTicker = useRef(ticker);
  useEffect(() => {
    const tickerChanged = prevTicker.current !== ticker;
    const before = prevCount.current;
    prevTicker.current = ticker;
    prevCount.current = count;
    if (tickerChanged) {
      // New ticker → re-evaluate from a collapsed first strip.
      setIndex(0);
      if (expanded) onExpandedChange(false);
      return;
    }
    if (count < before) {
      // A position closed: collapse (to the strip, or to the account view
      // when it was the last one) instead of leaving a stale card open.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIndex((i) => Math.min(i, Math.max(0, count - 1)));
      if (expanded) onExpandedChange(false);
    } else if (count > before) {
      pulse.setValue(0.6);
      Animated.spring(pulse, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ticker]);

  const setExpanded = (v: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onExpandedChange(v);
  };

  if (count === 0) {
    return (
      <>
        {/* Toolbar positions button with nothing open: the existing empty panel. */}
        {expanded && <PositionsPager data={data} ticker={ticker} onLiveUpdate={onLiveUpdate} />}
        <LiveAccountStrip bottomInset={bottomInset} />
      </>
    );
  }

  if (expanded) {
    return (
      <View style={{ paddingBottom: bottomInset, backgroundColor: colors.background }}>
        <View style={s.expandedHead}>
          {count > 1 ? (
            <Text style={[s.counter, { color: colors.textTertiary }]}>{index + 1}/{count}</Text>
          ) : <View />}
          <TouchableOpacity
            onPress={() => setExpanded(false)}
            hitSlop={10}
            style={s.collapseBtn}
            accessibilityLabel="Collapse position"
          >
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary }}>collapse</Text>
          </TouchableOpacity>
        </View>
        <PositionsPager
          data={data}
          ticker={ticker}
          onLiveUpdate={onLiveUpdate}
          initialIndex={index}
          onPageChange={setIndex}
        />
      </View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale: pulse }], paddingBottom: 6 + bottomInset, backgroundColor: colors.background }}>
      <StripPager
        positions={positions}
        index={index}
        onIndex={setIndex}
        onPress={() => setExpanded(true)}
        onLiveUpdate={onLiveUpdate}
        colors={colors}
      />
    </Animated.View>
  );
}

function StripPager({ positions, index, onIndex, onPress, onLiveUpdate, colors }: {
  positions: PositionEntry[];
  index: number;
  onIndex: (i: number) => void;
  onPress: () => void;
  onLiveUpdate: (strategyId: string, d: LivePriceData | null) => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const [width, setWidth] = useState(0);
  const listRef = useRef<FlatList>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - width) > 1) setWidth(w);
  };
  // Land on the page that was showing (e.g. coming back from expanded).
  useEffect(() => {
    if (width > 0 && index > 0) listRef.current?.scrollToOffset({ offset: index * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  return (
    <View onLayout={onLayout} style={[s.stripWrap, { borderTopColor: colors.separator }]}>
      {width > 0 && (
        <FlatList
          ref={listRef}
          data={positions}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          keyExtractor={(p) => p.strategy_id}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => onIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <View style={{ width, paddingHorizontal: 14 }}>
              <PositionStrip pos={item} onPress={onPress} onLiveUpdate={onLiveUpdate} colors={colors} />
            </View>
          )}
        />
      )}
      {positions.length > 1 && (
        <Text style={[s.counter, s.counterFloat, { color: colors.textTertiary }]}>
          {index + 1}/{positions.length}
        </Text>
      )}
    </View>
  );
}

function PositionStrip({ pos, onPress, onLiveUpdate, colors }: {
  pos: PositionEntry;
  onPress: () => void;
  onLiveUpdate: (strategyId: string, d: LivePriceData | null) => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  // Same live source the full position card uses — only one of the two is
  // ever mounted for a position, so this is never a second socket.
  const { data: live } = useStrategyLivePrice(pos.strategy_id, pos.active);
  useEffect(() => {
    onLiveUpdate(pos.strategy_id, live);
  }, [pos.strategy_id, live, onLiveUpdate]);
  useEffect(() => () => onLiveUpdate(pos.strategy_id, null), [pos.strategy_id, onLiveUpdate]);

  const entry = live?.entry_premium ?? pos.entry_premium;
  const now = live?.mid_price ?? pos.current_price;
  const qty = live?.qty_remaining ?? pos.qty_remaining ?? 0;
  const pnl = live?.pnl ?? pos.unrealized_pnl ?? 0;
  const pnlPct = live?.pnl_pct ?? pos.unrealized_pnl_pct;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const money = (v: number | null | undefined) => (v == null ? '—' : `$${v.toFixed(2)}`);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[s.strip, { backgroundColor: colors.card, borderColor: colors.cardBorder ?? colors.border }]}
      accessibilityLabel={`${pos.ticker} position — tap to expand`}
    >
      <View style={[s.edge, { backgroundColor: pnlColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[s.mono, { fontSize: 13, fontWeight: '800', color: colors.text }]} numberOfLines={1}>
          {contractLabel(pos)}
        </Text>
        <Text style={[s.mono, { fontSize: 11, color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
          {money(entry)} → <Text style={{ color: colors.text, fontWeight: '700' }}>{money(now)}</Text>
          {'  ·  '}Qty {qty}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[s.mono, { fontSize: 13, fontWeight: '800', color: pnlColor }]}>
          {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
        </Text>
        {pnlPct != null && (
          <Text style={[s.mono, { fontSize: 10.5, fontWeight: '700', color: pnlColor }]}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
          </Text>
        )}
      </View>
      <Ionicons name="chevron-up" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

/** "SPY251011C00781000" → "SPY 781C · 0DTE" (best-effort). */
function contractLabel(pos: PositionEntry): string {
  const m = (pos.contract ?? '').match(/^([A-Z.]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return pos.contract ? `${pos.ticker} ${pos.contract}` : pos.ticker;
  const [, sym, yy, mm, dd, cp, strike] = m;
  const k = Number(strike) / 1000;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const dte = Math.round((Date.UTC(2000 + +yy, +mm - 1, +dd) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return `${sym} ${k % 1 === 0 ? k.toFixed(0) : k.toFixed(2)}${cp} · ${dte <= 0 ? '0DTE' : `${dte}DTE`}`;
}

const s = StyleSheet.create({
  mono: { fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
  stripWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12,
    paddingVertical: 9, paddingRight: 12, paddingLeft: 14, overflow: 'hidden',
  },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  counter: { fontFamily: 'Menlo', fontSize: 10, fontWeight: '700' },
  counterFloat: { position: 'absolute', top: 0, right: 20 },
  expandedHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 4,
  },
  collapseBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
