import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Line, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { useReviewTradeChart } from '@/hooks/queries/review/useReviewTradeChart';
import type { ReviewTrade } from '@/common/types/review';

/**
 * Per-trade intraday chart for the Daily Review — price + VWAP overlay,
 * volume, and RSI(14), with the trade's actual entry/exit plotted on top.
 * This is the "point to Volume/RSI/VWAP" piece the review was missing:
 * instead of only reading "HARD_STOP at $0.42", the trader can see WHERE
 * that sat relative to the session's volume and momentum.
 *
 * Lazily mounted — only rendered once a trade card is expanded (see
 * ReviewDetailModal.tsx) — each instance is one live yfinance call.
 */

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 40 - 28; // screen padding (20×2) + card padding (14×2)
const PRICE_H = 100;
const VOL_H = 34;
const RSI_H = 46;
const GAP = 10;

function closestBarIndex(dates: string[], targetIso: string | null): number | null {
  if (!targetIso || dates.length === 0) return null;
  const target = new Date(targetIso).getTime();
  if (!Number.isFinite(target)) return null;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < dates.length; i++) {
    const diff = Math.abs(new Date(dates[i]).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best;
}

export function ReviewTradeChart({ trade, colors }: { trade: ReviewTrade; colors: any }) {
  const sessionDate = trade.entry_time?.slice(0, 10);
  const { data, isLoading, error } = useReviewTradeChart(trade.ticker, sessionDate, !!sessionDate);

  const geometry = useMemo(() => {
    if (!data || !data.available || data.closes.length < 2) return null;
    const n = data.closes.length;
    const x = (i: number) => (i / (n - 1)) * CHART_W;

    const priceVals = [...data.closes, ...data.vwap, trade.orh ?? undefined, trade.orl ?? undefined]
      .filter((v): v is number => typeof v === 'number');
    const pMin = Math.min(...priceVals);
    const pMax = Math.max(...priceVals);
    const pRange = (pMax - pMin) || 1;
    const yPrice = (v: number) => PRICE_H - ((v - pMin) / pRange) * PRICE_H;

    const maxVol = Math.max(...data.volumes, 1);
    const yVol = (v: number) => (v / maxVol) * VOL_H;

    const closeLine = data.closes.map((c, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yPrice(c).toFixed(1)}`).join(' ');

    // VWAP as a dashed overlay — draw as one continuous path (always defined once cum volume > 0)
    const vwapLine = data.vwap.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yPrice(v).toFixed(1)}`).join(' ');

    // RSI — skip the leading null run, break the path if a gap ever appears
    let rsiLine = '';
    let started = false;
    data.rsi.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const yr = RSI_H - (v / 100) * RSI_H;
      rsiLine += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${yr.toFixed(1)} `;
      started = true;
    });

    const entryIdx = closestBarIndex(data.dates, trade.entry_time);
    const exitIdx  = closestBarIndex(data.dates, trade.exit_time);

    return { x, yPrice, yVol, closeLine, vwapLine, rsiLine, entryIdx, exitIdx, pMin, pMax };
  }, [data, trade.entry_time, trade.exit_time, trade.orh, trade.orl]);

  if (isLoading) {
    return (
      <View style={[s.wrap, { borderColor: colors.border }]}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }

  if (error || !data?.available || !geometry) {
    return (
      <View style={[s.wrap, { borderColor: colors.border }]}>
        <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
          Chart unavailable — intraday data for this session has aged out of the data provider's window.
        </Text>
      </View>
    );
  }

  const { x, yPrice, yVol, closeLine, vwapLine, rsiLine, entryIdx, exitIdx } = geometry;
  const dirColor = trade.direction === 'CALL' ? colors.success : colors.error;

  return (
    <View style={[s.wrap, { borderColor: colors.border }]}>
      {/* Price + VWAP */}
      <Svg width={CHART_W} height={PRICE_H}>
        {trade.orh != null && (
          <Line x1={0} y1={yPrice(trade.orh)} x2={CHART_W} y2={yPrice(trade.orh)}
                stroke={colors.textTertiary} strokeWidth={1} strokeDasharray="2,3" opacity={0.6} />
        )}
        {trade.orl != null && (
          <Line x1={0} y1={yPrice(trade.orl)} x2={CHART_W} y2={yPrice(trade.orl)}
                stroke={colors.textTertiary} strokeWidth={1} strokeDasharray="2,3" opacity={0.6} />
        )}
        <Path d={vwapLine} stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="4,3" fill="none" opacity={0.9} />
        <Path d={closeLine} stroke={colors.text} strokeWidth={2} fill="none" />
        {entryIdx != null && (
          <>
            <Line x1={x(entryIdx)} y1={0} x2={x(entryIdx)} y2={PRICE_H} stroke={colors.success} strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
            <Circle cx={x(entryIdx)} cy={yPrice(data.closes[entryIdx])} r={3.5} fill={colors.success} />
          </>
        )}
        {exitIdx != null && (
          <>
            <Line x1={x(exitIdx)} y1={0} x2={x(exitIdx)} y2={PRICE_H} stroke={colors.error} strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
            <Circle cx={x(exitIdx)} cy={yPrice(data.closes[exitIdx])} r={3.5} fill={colors.error} />
          </>
        )}
      </Svg>
      <View style={s.legendRow}>
        <LegendDot color={colors.text} label="Price" colors={colors} />
        <LegendDot color="#F59E0B" label="VWAP" dashed colors={colors} />
        <LegendDot color={colors.success} label="Entry" colors={colors} />
        <LegendDot color={colors.error} label="Exit" colors={colors} />
      </View>

      {/* Volume */}
      <Text style={[s.paneLabel, { color: colors.textTertiary }]}>VOLUME</Text>
      <Svg width={CHART_W} height={VOL_H}>
        {data.volumes.map((v, i) => {
          const barW = Math.max(1, CHART_W / data.volumes.length - 1);
          const h = yVol(v);
          const up = data.closes[i] >= (data.opens[i] ?? data.closes[i]);
          return (
            <Rect key={i} x={x(i) - barW / 2} y={VOL_H - h} width={barW} height={h}
                  fill={up ? colors.success : colors.error} opacity={0.55} />
          );
        })}
      </Svg>

      {/* RSI */}
      <Text style={[s.paneLabel, { color: colors.textTertiary, marginTop: 8 }]}>RSI (14)</Text>
      <Svg width={CHART_W} height={RSI_H}>
        <Line x1={0} y1={RSI_H - (70 / 100) * RSI_H} x2={CHART_W} y2={RSI_H - (70 / 100) * RSI_H}
              stroke={colors.error} strokeWidth={1} strokeDasharray="2,3" opacity={0.5} />
        <Line x1={0} y1={RSI_H - (30 / 100) * RSI_H} x2={CHART_W} y2={RSI_H - (30 / 100) * RSI_H}
              stroke={colors.success} strokeWidth={1} strokeDasharray="2,3" opacity={0.5} />
        <Path d={rsiLine} stroke="#8B5CF6" strokeWidth={1.5} fill="none" />
      </Svg>
      <View style={s.rsiAxisRow}>
        <Text style={[s.axisText, { color: colors.textTertiary }]}>30</Text>
        <Text style={[s.axisText, { color: colors.textTertiary }]}>70 overbought · 30 oversold</Text>
        <Text style={[s.axisText, { color: colors.textTertiary }]}>70</Text>
      </View>
    </View>
  );
}

const LegendDot = ({ color, label, dashed, colors }: { color: string; label: string; dashed?: boolean; colors: any }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <View style={{ width: 10, height: dashed ? 1.5 : 2, backgroundColor: color, borderRadius: 1 }} />
    <Text style={{ color: colors.textTertiary, fontSize: 10 }}>{label}</Text>
  </View>
);

const s = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, gap: 4 },
  legendRow: { flexDirection: 'row', gap: 12, marginTop: 2, marginBottom: 2 },
  paneLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 },
  rsiAxisRow: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: 9 },
});
