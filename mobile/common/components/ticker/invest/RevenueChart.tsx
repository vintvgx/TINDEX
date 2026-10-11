import React, { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Line, Text as SvgText } from 'react-native-svg';
import type { RevenueBar } from '@/hooks/queries/ticker/useTickerFundamentals';

/**
 * Revenue: actual + estimates (invest-tab-thesis-mock). Solid gradient bars
 * are reported annual revenue; dashed bars are the analyst consensus with a
 * low–high whisker. Value labels sit on top of each bar, FY labels below.
 */

const H = 170;
const TOP = 20;        // room for the value label
const BOTTOM = 22;     // room for the FY label
const PLOT = H - TOP - BOTTOM;
const ACCENT = '#4a9eff';

export function fmtRevenue(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(v >= 1e13 ? 0 : 1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

export function RevenueChart({ bars, colors }: { bars: RevenueBar[]; colors: any }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const max = Math.max(...bars.map((b) => Math.max(b.value, b.high ?? 0)), 1);
  const y = (v: number) => TOP + PLOT - (v / max) * PLOT;
  const slot = bars.length ? w / bars.length : 0;
  const barW = Math.min(44, slot * 0.72);

  return (
    <View onLayout={onLayout} style={{ height: H }}>
      {w > 0 && (
        <Svg width={w} height={H}>
          <Defs>
            <LinearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ACCENT} />
              <Stop offset="1" stopColor="#2b5cb8" />
            </LinearGradient>
          </Defs>
          {bars.map((b, i) => {
            const cx = slot * i + slot / 2;
            const top = Math.min(y(b.value), TOP + PLOT - 6);
            const h = TOP + PLOT - top;
            const x = cx - barW / 2;
            const hasWhisker = b.estimate && b.low != null && b.high != null;
            const labelY = (hasWhisker ? Math.min(top, y(b.high!)) : top) - 6;
            return (
              <React.Fragment key={b.label}>
                {b.estimate ? (
                  <Rect x={x} y={top} width={barW} height={h} rx={7}
                        fill={ACCENT} fillOpacity={0.1} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4,3" />
                ) : (
                  <Rect x={x} y={top} width={barW} height={h} rx={7} fill="url(#rev)" />
                )}
                {hasWhisker && (
                  <>
                    <Line x1={cx} x2={cx} y1={y(b.high!)} y2={y(b.low!)} stroke={colors.text} strokeOpacity={0.7} strokeWidth={1.5} />
                    <Line x1={cx - 5} x2={cx + 5} y1={y(b.high!)} y2={y(b.high!)} stroke={colors.text} strokeOpacity={0.7} strokeWidth={1.5} />
                    <Line x1={cx - 5} x2={cx + 5} y1={y(b.low!)} y2={y(b.low!)} stroke={colors.text} strokeOpacity={0.7} strokeWidth={1.5} />
                  </>
                )}
                <SvgText x={cx} y={labelY} fontSize={10.5} fontWeight="800" fill={colors.text} textAnchor="middle">
                  {fmtRevenue(b.value)}
                </SvgText>
                <SvgText x={cx} y={H - 6} fontSize={11} fill={b.estimate ? ACCENT : colors.textSecondary} textAnchor="middle">
                  {b.label}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      )}
    </View>
  );
}
