import React from 'react';
import { View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import type { useThemeColors } from '@/lib/useColorScheme';

/**
 * Small red/green daily P&L bar chart for the Trading slide's week view —
 * hand-rolled SVG, same convention as ReviewTradeChart.tsx rather than
 * pulling in a charting library for one simple bar row.
 */
export function DigestBarChart({
  values, width, height = 64, colors,
}: {
  values: number[];
  width: number;
  height?: number;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (values.length === 0) return null;
  const maxAbs = Math.max(...values.map(v => Math.abs(v)), 1);
  const zeroY = height / 2;
  const barW = Math.max(4, width / values.length - 6);

  return (
    <View>
      <Svg width={width} height={height}>
        <Line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={colors.border} strokeWidth={1} />
        {values.map((v, i) => {
          const barH = (Math.abs(v) / maxAbs) * (height / 2 - 4);
          const x = (i + 0.5) * (width / values.length) - barW / 2;
          const y = v >= 0 ? zeroY - barH : zeroY;
          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 1.5)}
              rx={2}
              fill={v >= 0 ? colors.success : colors.error}
              opacity={0.85}
            />
          );
        })}
      </Svg>
    </View>
  );
}
