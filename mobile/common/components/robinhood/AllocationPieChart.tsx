import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export interface PieSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Small in-house SVG donut chart — no external charting library, matching
 * this app's existing preference for hand-rolled react-native-svg pieces
 * (see TradeAnalytics.tsx's EquitySparkline) over pulling in something like
 * react-native-chart-kit for a single simple shape.
 */
export function AllocationPieChart({
  slices, size = 120, colors,
}: {
  slices: PieSlice[]; size?: number; colors: any;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  const r = size / 2;
  const innerR = r * 0.6;
  let angle = -Math.PI / 2;

  const arcs = slices.map(slice => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const angleEnd = angle + sweep;
    const largeArc = sweep > Math.PI ? 1 : 0;

    const x1 = r + r * Math.cos(angle);
    const y1 = r + r * Math.sin(angle);
    const x2 = r + r * Math.cos(angleEnd);
    const y2 = r + r * Math.sin(angleEnd);
    const ix1 = r + innerR * Math.cos(angleEnd);
    const iy1 = r + innerR * Math.sin(angleEnd);
    const ix2 = r + innerR * Math.cos(angle);
    const iy2 = r + innerR * Math.sin(angle);

    // A full-circle single slice (100% one sector) degenerates the arc
    // command below (start === end), so it's drawn as two half-arcs instead.
    const d = sweep >= Math.PI * 2 - 0.001
      ? [
          `M${r},${r - r} A${r},${r} 0 1 1 ${r - 0.01},${r - r} A${r},${r} 0 1 1 ${r},${r - r}`,
          `M${r},${r - innerR} A${innerR},${innerR} 0 1 0 ${r - 0.01},${r - innerR} A${innerR},${innerR} 0 1 0 ${r},${r - innerR}`,
        ].join(' ')
      : `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z`;

    angle = angleEnd;
    return { key: slice.key, d, color: slice.color };
  });

  return (
    <Svg width={size} height={size}>
      {arcs.map(a => (
        <Path key={a.key} d={a.d} fill={a.color} fillRule="evenodd" />
      ))}
    </Svg>
  );
}

/** Color/label/percent legend rows to pair with AllocationPieChart. */
export function AllocationLegend({ slices, colors }: { slices: PieSlice[]; colors: any }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  return (
    <View style={{ gap: 8, flex: 1 }}>
      {slices.map(s => {
        const pct = (s.value / total) * 100;
        return (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={{ color: colors.tabBarInactive, fontSize: 12, fontWeight: '600' }}>
              {pct.toFixed(0)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}
