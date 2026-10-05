import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { useUserORBFollows } from '@/hooks/mutations/ticker/tickerORB';
import type { TickerInfo } from '../DynamicCard';

/**
 * Dynamic card "charts" view: one simple line chart per followed ticker —
 * no technicals, just the line. Vertical swipe up/down pages tickers.
 */

const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];

function Sparkline({ prices, width, height, up, colors }: {
  prices: number[];
  width: number;
  height: number;
  up: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const { points, last } = useMemo(() => {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const stepX = width / Math.max(1, prices.length - 1);
    const pts = prices
      .map((p, i) => `${(i * stepX).toFixed(1)},${(height - 8 - ((p - min) / range) * (height - 16)).toFixed(1)}`)
      .join(' ');
    const lx = ((prices.length - 1) * stepX).toFixed(1);
    const ly = (height - 8 - ((prices[prices.length - 1] - min) / range) * (height - 16)).toFixed(1);
    return { points: pts, last: { x: Number(lx), y: Number(ly) } };
  }, [prices, width, height]);

  const stroke = up ? colors.success : colors.error;
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={3.5} fill={stroke} />
    </Svg>
  );
}

function TickerPage({
  ticker,
  height,
  width,
  onStats,
}: {
  ticker: string;
  height: number;
  width: number;
  onStats: (ticker: string, price: number | null, changePct: number | null) => void;
}) {
  const colors = useThemeColors();
  const { data } = useTickerHistoryQuery(ticker, '1D', 60_000);
  const prices = data?.data?.prices ?? [];

  const price = prices.length > 0 ? prices[prices.length - 1] : null;
  const changePct = prices.length > 1 ? ((prices[prices.length - 1] / prices[0]) - 1) * 100 : null;
  const up = (changePct ?? 0) >= 0;

  React.useEffect(() => {
    onStats(ticker, price, changePct);
  }, [ticker, price, changePct, onStats]);

  return (
    <View style={{ width, height, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Text style={[styles.mono, { fontSize: 22, fontWeight: '800', color: colors.text }]}>{ticker}</Text>
        {price != null && (
          <Text style={[styles.mono, { fontSize: 20, color: colors.textSecondary }]}>
            ${price.toFixed(2)}
          </Text>
        )}
        {changePct != null && (
          <View
            style={{
              borderRadius: 6,
              paddingHorizontal: 7,
              paddingVertical: 3,
              backgroundColor: (up ? colors.success : colors.error) + '1E',
            }}
          >
            <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: up ? colors.success : colors.error }]}>
              {up ? '+' : ''}{changePct.toFixed(2)}%
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, marginTop: 2 }]}>
        TODAY · SWIPE UP/DOWN FOR NEXT TICKER
      </Text>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {prices.length > 1 ? (
          <Sparkline prices={prices} width={width - 28} height={height - 130} up={up} colors={colors} />
        ) : (
          <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center' }}>
            Loading chart…
          </Text>
        )}
      </View>
    </View>
  );
}

export function DynamicChartsView({
  onActiveTicker,
  height,
}: {
  onActiveTicker: (info: TickerInfo) => void;
  height: number;
}) {
  const { width } = useWindowDimensions();
  const pageWidth = width - 28;
  const { data: follows } = useUserORBFollows();
  const tickers = useMemo(() => {
    const list = (follows ?? []).map((f) => f.ticker.toUpperCase());
    return list.length > 0 ? list : FALLBACK_TICKERS;
  }, [follows]);
  const [active, setActive] = useState(0);
  const [stats, setStats] = useState<Record<string, { price: number | null; changePct: number | null }>>({});

  const onStats = useCallback((ticker: string, price: number | null, changePct: number | null) => {
    setStats((s) => {
      const prev = s[ticker];
      if (prev && prev.price === price && prev.changePct === changePct) return s;
      return { ...s, [ticker]: { price, changePct } };
    });
  }, []);

  const activeTicker = tickers[active] ?? '';

  // Report the active ticker (+ its latest stats) for the collapsed strip.
  React.useEffect(() => {
    const s = stats[activeTicker];
    onActiveTicker({ ticker: activeTicker, price: s?.price ?? null, changePct: s?.changePct ?? null });
  }, [activeTicker, stats, onActiveTicker]);

  const onViewableChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      const i = viewableItems[0]?.index;
      if (i != null) setActive(i);
    },
    [],
  );

  return (
    <View style={{ width: pageWidth }}>
      <FlatList
        data={tickers}
        keyExtractor={(t) => t}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        style={{ height: height - 28 }}
        renderItem={({ item }) => (
          <TickerPage ticker={item} height={height - 28} width={pageWidth} onStats={onStats} />
        )}
        onViewableItemsChanged={onViewableChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, index) => ({ length: height - 28, offset: (height - 28) * index, index })}
      />
      {/* ticker position dots */}
      {tickers.length > 1 && (
        <View style={styles.tickerDots}>
          {tickers.map((t, i) => (
            <View
              key={t}
              style={[
                styles.tickerDot,
                { backgroundColor: i === active ? '#fff' : 'rgba(255,255,255,0.25)' },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  tickerDots: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    gap: 5,
  },
  tickerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
