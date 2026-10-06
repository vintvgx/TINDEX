import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle, Line, Rect, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

/**
 * The app's one line chart — shared by the ticker sheet (ticker.tsx →
 * TickerDetailSheet) and the Home dynamic card's chart page, which used to
 * be two different charts (one with axes, one with a period picker + scrub).
 *
 * - Price (y) axis with round ticks + a current-price tag; time (x) axis.
 * - 1D spans the full 9:30–4:00 ET session, so at the open the line starts
 *   at the left edge and grows through the day (Robinhood-style). Longer
 *   ranges space bars evenly (no overnight/weekend gaps).
 * - Long-press to scrub: marker + crosshair + an in-chart price/time label,
 *   reported via onScrub (the ticker sheet swaps its header price with it).
 * - Optional period picker (onPeriodChange) and expand button (onExpand —
 *   both callers open the full chart, charts.tsx, on this ticker).
 */

export const CHART_PERIODS: PricePeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y'];

export interface ScrubPoint {
  price: number;
  date: string;
  index: number;
}

const Y_AXIS_W = 52;
const X_AXIS_H = 18;
const SESSION_OPEN_MIN = 9 * 60 + 30;
const SESSION_LEN_MIN = 390; // 9:30 → 16:00 ET

/** ET month/day + minutes since midnight. */
function etParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: '2-digit', day: '2-digit',
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

/** Scrub label: time on short ranges, year on long ones. */
function scrubLabel(dateStr: string, period: PricePeriod): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: period === '1Y' || period === '5Y' ? 'numeric' : undefined,
    hour: period === '1D' || period === '1W' ? 'numeric' : undefined,
    minute: period === '1D' || period === '1W' ? '2-digit' : undefined,
  });
}

export function LinePriceChart({
  dates,
  prices,
  period,
  height = 200,
  isLoading,
  positive,
  onScrub,
  onPeriodChange,
  onExpand,
}: {
  dates: string[];
  prices: number[];
  period: PricePeriod;
  /** Chart height including the x-axis (not the period picker). */
  height?: number;
  isLoading?: boolean;
  /** Line color direction; defaults to last price vs first. */
  positive?: boolean;
  onScrub?: (point: ScrubPoint | null) => void;
  /** Shows the 1D…5Y picker under the chart. */
  onPeriodChange?: (period: PricePeriod) => void;
  /** Shows an expand button (top-right) — open the full chart. */
  onExpand?: () => void;
}) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const n = Math.min(dates.length, prices.length);
  const hasData = n > 1 && width > 0;
  const up = positive ?? (n > 1 ? prices[n - 1] >= prices[0] : true);
  const stroke = up ? colors.success : colors.error;
  const plotW = Math.max(0, width - Y_AXIS_W);
  const plotH = height - X_AXIS_H;

  const model = useMemo(() => {
    if (!hasData) return null;
    const ts = dates.slice(0, n).map((d) => new Date(d));
    const ps = prices.slice(0, n);
    const min = Math.min(...ps);
    const max = Math.max(...ps);
    const pad = (max - min || max * 0.01 || 1) * 0.08;
    const lo = min - pad;
    const hi = max + pad;
    const y = (p: number) => 4 + (1 - (p - lo) / (hi - lo)) * (plotH - 8);

    let xs: number[];
    let xLabels: Array<{ x: number; text: string }>;
    if (period === '1D') {
      // Fixed 9:30–4:00 session domain — the line covers only the elapsed
      // part of the day.
      xs = ts.map((t) => Math.max(0, Math.min(1, (etParts(t).mins - SESSION_OPEN_MIN) / SESSION_LEN_MIN)) * plotW);
      xLabels = [0, 150, 270, SESSION_LEN_MIN].map((m) => ({
        x: (m / SESSION_LEN_MIN) * plotW,
        text: fmtClock(SESSION_OPEN_MIN + m),
      }));
    } else {
      xs = ps.map((_, i) => (i / (n - 1)) * plotW);
      const withTime = period === '1W';
      xLabels = [0, Math.floor((n - 1) / 2), n - 1].map((i) => {
        const e = etParts(ts[i]);
        return { x: xs[i], text: withTime ? `${e.month}/${e.day} ${fmtClock(e.mins)}` : `${e.month}/${e.day}` };
      });
    }
    const ys = ps.map(y);
    let line = '';
    for (let i = 0; i < n; i++) line += `${i === 0 ? 'M' : ' L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
    const area = `${line} L${xs[n - 1].toFixed(1)},${plotH} L${xs[0].toFixed(1)},${plotH} Z`;
    const ticks = niceTicks(min, max).map((v) => ({ v, y: y(v) }));
    return { xs, ys, line, area, ticks, xLabels };
  }, [hasData, dates, prices, n, period, plotW, plotH]);

  // ── Scrub (long-press, then drag) ────────────────────────────────────
  const scrubRef = useRef<number | null>(null);
  const setScrub = useCallback((i: number | null) => {
    const prev = scrubRef.current;
    if (prev === i) return;
    scrubRef.current = i;
    if (i != null && prev == null) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setScrubIndex(i);
    onScrub?.(i == null ? null : { price: prices[i], date: dates[i], index: i });
  }, [onScrub, prices, dates]);

  const touchAt = useCallback((x: number) => {
    if (!model) return;
    // Nearest bar by x (xs is non-decreasing).
    const xsArr = model.xs;
    let lo = 0;
    let hi = xsArr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xsArr[mid] < x) lo = mid + 1; else hi = mid;
    }
    const i = lo > 0 && Math.abs(xsArr[lo - 1] - x) <= Math.abs(xsArr[lo] - x) ? lo - 1 : lo;
    setScrub(i);
  }, [model, setScrub]);
  const endScrub = useCallback(() => setScrub(null), [setScrub]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(150)
        .onStart((e) => {
          'worklet';
          runOnJS(touchAt)(e.x);
        })
        .onUpdate((e) => {
          'worklet';
          runOnJS(touchAt)(e.x);
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(endScrub)();
        }),
    [touchAt, endScrub],
  );

  const last = model ? { x: model.xs[n - 1], y: model.ys[n - 1], price: prices[n - 1] } : null;
  const tagH = 16;
  const tagY = last ? Math.max(0, Math.min(plotH - tagH, last.y - tagH / 2)) : 0;
  const scrub = model && scrubIndex != null ? { x: model.xs[scrubIndex], y: model.ys[scrubIndex] } : null;

  return (
    <View>
      <View onLayout={onLayout} style={{ height, width: '100%' }}>
        {!model ? (
          <View style={[styles.empty, { backgroundColor: colors.surfaceSecondary }]}>
            {!isLoading && (
              <>
                <Ionicons name="bar-chart-outline" size={30} color={colors.textTertiary} />
                <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 6 }}>
                  {n <= 1 && width > 0 ? 'No chart data available' : ''}
                </Text>
              </>
            )}
          </View>
        ) : (
          <GestureDetector gesture={gesture}>
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="lpcFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={stroke} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {/* grid + y-axis */}
              {model.ticks.map((t) => (
                <React.Fragment key={t.v}>
                  <Line x1={0} x2={plotW} y1={t.y} y2={t.y} stroke={colors.textTertiary} strokeOpacity={0.15} strokeWidth={1} />
                  <SvgText x={plotW + 6} y={t.y + 3.5} fontSize={9.5} fontFamily="Menlo" fill={colors.textTertiary}>
                    {t.v.toFixed(2)}
                  </SvgText>
                </React.Fragment>
              ))}
              {/* x-axis */}
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
              {/* area + line */}
              <Path d={model.area} fill="url(#lpcFill)" />
              <Path d={model.line} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {/* current price: dashed guide, dot, axis tag */}
              {last && (
                <>
                  <Line x1={last.x} x2={plotW} y1={last.y} y2={last.y} stroke={stroke} strokeOpacity={0.6} strokeDasharray="3,3" />
                  <Circle cx={last.x} cy={last.y} r={3.5} fill={stroke} />
                  <Rect x={plotW + 2} y={tagY} width={Y_AXIS_W - 2} height={tagH} rx={4} fill={stroke} />
                  <SvgText x={plotW + 2 + (Y_AXIS_W - 2) / 2} y={tagY + 11.5} fontSize={10} fontWeight="700" fontFamily="Menlo" fill="#fff" textAnchor="middle">
                    {last.price.toFixed(2)}
                  </SvgText>
                </>
              )}
              {/* scrub crosshair + marker */}
              {scrub && (
                <>
                  <Line x1={scrub.x} x2={scrub.x} y1={0} y2={plotH} stroke={colors.textSecondary} strokeWidth={1} strokeDasharray="4,4" />
                  <Circle cx={scrub.x} cy={scrub.y} r={5} fill={stroke} stroke={colors.background} strokeWidth={2} />
                </>
              )}
            </Svg>
          </GestureDetector>
        )}

        {/* scrub label — price + time, pinned to the top of the plot */}
        {scrub && scrubIndex != null && (
          <View
            pointerEvents="none"
            style={[
              styles.scrubLabel,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                left: Math.max(0, Math.min(plotW - 150, scrub.x - 75)),
              },
            ]}
          >
            <Text style={[styles.mono, { fontSize: 11, fontWeight: '800', color: colors.text }]}>
              ${prices[scrubIndex].toFixed(2)}
            </Text>
            <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
              {scrubLabel(dates[scrubIndex], period)}
            </Text>
          </View>
        )}

        {onExpand && (
          <Pressable
            onPress={onExpand}
            hitSlop={10}
            accessibilityLabel="Open full chart"
            style={[styles.expand, { backgroundColor: colors.surfaceSecondary + 'E6', right: Y_AXIS_W + 4 }]}
          >
            <Ionicons name="expand-outline" size={15} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {onPeriodChange && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
          {CHART_PERIODS.map((p) => {
            const active = p === period;
            return (
              <Pressable
                key={p}
                onPress={() => onPeriodChange(p)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 10,
                  backgroundColor: active ? colors.accent : 'transparent',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? colors.accentForeground : colors.textSecondary }}>
                  {p}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  scrubLabel: {
    position: 'absolute',
    top: 2,
    width: 150,
    alignItems: 'center',
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  expand: {
    position: 'absolute',
    top: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
