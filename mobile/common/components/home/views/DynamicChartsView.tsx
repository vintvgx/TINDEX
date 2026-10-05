import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Polyline, Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { useUserORBFollows } from '@/hooks/mutations/ticker/tickerORB';
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs';
import { ALLOWED_INTERVALS, DEFAULT_INTERVAL, INTERVAL_LABEL } from '@/lib/chartIntervals';
import { intervalCycleFor } from '@/common/components/ticker/TimeframeChips';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import type { TickerInfo } from '../DynamicCard';

/**
 * Dynamic card "charts" view: one line chart per followed ticker with a
 * price (y) axis, a time (x) axis and a current-price tag. Timeframe comes
 * from Profile → Home chart timeframe (default 1D · 15m). On 1D the x-axis
 * always spans the full 9:30–4:00 session, so at the open the line starts
 * at the left edge and grows through the day (Robinhood-style). Swipe up/
 * down pages tickers; a "1/N" counter shows for 8s after each swipe.
 */

const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];
const Y_AXIS_W = 52;
const X_AXIS_H = 18;
const COUNTER_VISIBLE_MS = 8000;
const SESSION_OPEN_MIN = 9 * 60 + 30;
const SESSION_LEN_MIN = 390; // 9:30 → 16:00

type Colors = ReturnType<typeof useThemeColors>;

/** ET calendar date + minutes since midnight. */
function etParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
  return {
    month: Number(get('month')), day: Number(get('day')),
    mins: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

function fmtClock(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${h12}${h >= 12 ? 'PM' : 'AM'}` : `${h12}:${String(m).padStart(2, '0')}`;
}

/** ~3-4 round price ticks spanning [min, max]. */
function niceTicks(min: number, max: number): number[] {
  const span = max - min || Math.max(Math.abs(max) * 0.01, 0.01);
  const raw = span / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

function LineChart({ dates, prices, period, width, height, up, colors }: {
  dates: string[]; prices: number[]; period: PricePeriod;
  width: number; height: number; up: boolean; colors: Colors;
}) {
  const plotW = width - Y_AXIS_W;
  const plotH = height - X_AXIS_H;

  const model = useMemo(() => {
    const n = Math.min(dates.length, prices.length);
    const ts = dates.slice(0, n).map((d) => new Date(d));
    const ps = prices.slice(0, n);
    const min = Math.min(...ps);
    const max = Math.max(...ps);
    const pad = (max - min || max * 0.01 || 1) * 0.08;
    const lo = min - pad;
    const hi = max + pad;
    const y = (p: number) => 4 + (1 - (p - lo) / (hi - lo)) * (plotH - 8);

    let x: (i: number) => number;
    let xLabels: Array<{ x: number; text: string }>;
    if (period === '1D') {
      // Fixed 9:30–4:00 session domain — the line occupies only the elapsed
      // part of the day, starting at the left edge at the open.
      const minsOf = ts.map((t) => etParts(t).mins);
      x = (i: number) => Math.max(0, Math.min(1, (minsOf[i] - SESSION_OPEN_MIN) / SESSION_LEN_MIN)) * plotW;
      xLabels = [SESSION_OPEN_MIN, SESSION_OPEN_MIN + 150, SESSION_OPEN_MIN + 270, SESSION_OPEN_MIN + SESSION_LEN_MIN].map(
        (m) => ({ x: ((m - SESSION_OPEN_MIN) / SESSION_LEN_MIN) * plotW, text: fmtClock(m) }),
      );
    } else {
      // Even spacing by bar (skips overnight/weekend gaps).
      x = (i: number) => (n > 1 ? (i / (n - 1)) * plotW : 0);
      const intraday = period === '1W';
      xLabels = [0, Math.floor((n - 1) / 2), n - 1].map((i) => {
        const e = etParts(ts[i]);
        return { x: x(i), text: intraday ? `${e.month}/${e.day} ${fmtClock(e.mins)}` : `${e.month}/${e.day}` };
      });
    }
    const points = ps.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    const last = { x: x(n - 1), y: y(ps[n - 1]), price: ps[n - 1] };
    const ticks = niceTicks(min, max).map((v) => ({ v, y: y(v) }));
    return { points, last, ticks, xLabels };
  }, [dates, prices, period, plotW, plotH]);

  const stroke = up ? colors.success : colors.error;
  const tagH = 16;
  const tagY = Math.max(0, Math.min(plotH - tagH, model.last.y - tagH / 2));
  return (
    <Svg width={width} height={height}>
      {/* horizontal grid + y-axis labels */}
      {model.ticks.map((t) => (
        <React.Fragment key={t.v}>
          <Line x1={0} x2={plotW} y1={t.y} y2={t.y} stroke={colors.textTertiary} strokeOpacity={0.15} strokeWidth={1} />
          <SvgText x={plotW + 6} y={t.y + 3.5} fontSize={9.5} fontFamily="Menlo" fill={colors.textTertiary}>
            {t.v.toFixed(2)}
          </SvgText>
        </React.Fragment>
      ))}
      {/* x-axis baseline + labels */}
      <Line x1={0} x2={plotW} y1={plotH} y2={plotH} stroke={colors.textTertiary} strokeOpacity={0.3} strokeWidth={1} />
      {model.xLabels.map((l, i) => (
        <SvgText
          key={i}
          x={l.x}
          y={plotH + 13}
          fontSize={9.5}
          fontFamily="Menlo"
          fill={colors.textTertiary}
          textAnchor={i === 0 ? 'start' : i === model.xLabels.length - 1 ? 'end' : 'middle'}
        >
          {l.text}
        </SvgText>
      ))}
      {/* price line + current-price marker, dashed guide and axis tag */}
      <Polyline points={model.points} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Line x1={model.last.x} x2={plotW} y1={model.last.y} y2={model.last.y} stroke={stroke} strokeOpacity={0.6} strokeDasharray="3,3" />
      <Circle cx={model.last.x} cy={model.last.y} r={3.5} fill={stroke} />
      <Rect x={plotW + 2} y={tagY} width={Y_AXIS_W - 2} height={tagH} rx={4} fill={stroke} />
      <SvgText x={plotW + 2 + (Y_AXIS_W - 2) / 2} y={tagY + 11.5} fontSize={10} fontWeight="700" fontFamily="Menlo" fill="#fff" textAnchor="middle">
        {model.last.price.toFixed(2)}
      </SvgText>
    </Svg>
  );
}

function TickerPage({ ticker, height, width, period, interval, onStats }: {
  ticker: string; height: number; width: number; period: PricePeriod; interval: string;
  onStats: (ticker: string, price: number | null, changePct: number | null) => void;
}) {
  const colors = useThemeColors();
  const { data } = useTickerHistoryQuery(ticker, period, 60_000, interval);
  const prices = data?.data?.prices ?? [];
  const dates = data?.data?.dates ?? [];

  const price = prices.length > 0 ? prices[prices.length - 1] : null;
  const changePct = prices.length > 1 ? ((prices[prices.length - 1] / prices[0]) - 1) * 100 : null;
  const up = (changePct ?? 0) >= 0;

  useEffect(() => {
    onStats(ticker, price, changePct);
  }, [ticker, price, changePct, onStats]);

  return (
    <View style={{ width, height, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Text style={[styles.mono, { fontSize: 22, fontWeight: '800', color: colors.text }]}>{ticker}</Text>
        {price != null && (
          <Text style={[styles.mono, { fontSize: 20, color: colors.textSecondary }]}>${price.toFixed(2)}</Text>
        )}
        {changePct != null && (
          <View style={{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: (up ? colors.success : colors.error) + '1E' }}>
            <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: up ? colors.success : colors.error }]}>
              {up ? '+' : ''}{changePct.toFixed(2)}%
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, marginTop: 2 }]}>
        {period} · {INTERVAL_LABEL[interval] ?? interval}
      </Text>
      <View style={{ flex: 1, justifyContent: 'center', marginTop: 8 }}>
        {prices.length > 0 ? (
          <LineChart dates={dates} prices={prices} period={period} width={width - 28} height={height - 96} up={up} colors={colors} />
        ) : (
          <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center' }}>Loading chart…</Text>
        )}
      </View>
    </View>
  );
}

export function DynamicChartsView({ onActiveTicker, height }: {
  onActiveTicker: (info: TickerInfo) => void;
  height: number;
}) {
  const { width } = useWindowDimensions();
  const pageWidth = width - 28;
  const { data: follows } = useUserORBFollows();
  const { prefs } = useChartDisplayPrefs();
  const period = prefs.homeChartPeriod;
  const allowed = intervalCycleFor(ALLOWED_INTERVALS[period]);
  const interval = allowed.includes(prefs.homeChartInterval) ? prefs.homeChartInterval : DEFAULT_INTERVAL[period];

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
  useEffect(() => {
    const s = stats[activeTicker];
    onActiveTicker({ ticker: activeTicker, price: s?.price ?? null, changePct: s?.changePct ?? null });
  }, [activeTicker, stats, onActiveTicker]);

  // "1/N" counter — fades in on a swipe, out 8s after the last one.
  const counterOpacity = useSharedValue(0);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    counterOpacity.value = withTiming(1, { duration: 150 });
    counterOpacity.value = withDelay(COUNTER_VISIBLE_MS, withTiming(0, { duration: 400 }));
  }, [active, counterOpacity]);
  const counterStyle = useAnimatedStyle(() => ({ opacity: counterOpacity.value }));

  const onViewableChanged = useCallback(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }, []);

  const pageH = height - 28;
  return (
    <View style={{ width: pageWidth }}>
      <FlatList
        data={tickers}
        keyExtractor={(t) => t}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        style={{ height: pageH }}
        renderItem={({ item }) => (
          <TickerPage ticker={item} height={pageH} width={pageWidth} period={period} interval={interval} onStats={onStats} />
        )}
        onViewableItemsChanged={onViewableChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
      />
      {tickers.length > 1 && (
        <Animated.View pointerEvents="none" style={[styles.counter, counterStyle]}>
          <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', color: '#fff' }]}>
            {active + 1}/{tickers.length}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  counter: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
