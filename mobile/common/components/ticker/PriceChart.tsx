import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Polyline,
  Line,
  Circle,
  Text as SvgText,
  Rect,
  G,
} from 'react-native-svg';
import { useThemeColors } from '@/lib/useColorScheme';
import {
  buildCoords,
  buildPolylinePoints,
  buildAreaPath,
  getLabelIndices,
  formatAxisLabel,
  formatTooltipDate,
  type ChartPeriod,
  type IndicatorLine,
  type ChartDataPoint,
} from '@/common/utils/chartUtils';

// ─── Layout constants ─────────────────────────────────────────────────────────

const DEFAULT_CHART_HEIGHT = 200;
const PAD_TOP = 10;
const PAD_RIGHT = 52; // y-axis label column
const PAD_BOTTOM = 28; // x-axis label row
const PAD_LEFT = 4;
const Y_GRID_LINES = 4;
const MAX_X_LABELS = 5;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  points: ChartDataPoint[];
  period: ChartPeriod;
  width: number;
  /** True = green line, false = red line */
  isPositive: boolean;
  /** Override chart height — defaults to 200 */
  height?: number;
  /**
   * Indicator overlays — same price scale as the main chart.
   * RSI and other oscillators need a separate sub-chart (not yet implemented).
   */
  indicators?: IndicatorLine[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export const PriceChart: React.FC<Props> = ({
  points,
  period,
  width,
  isPositive,
  height = DEFAULT_CHART_HEIGHT,
  indicators = [],
}) => {
  const colors = useThemeColors();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const plotLeft = PAD_LEFT;
  const plotTop = PAD_TOP;
  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const plotBottom = PAD_TOP + plotHeight;
  const svgHeight = height;

  const prices = useMemo(() => points.map(p => p.price), [points]);

  const minPrice = useMemo(() => Math.min(...prices), [prices]);
  const maxPrice = useMemo(() => Math.max(...prices), [prices]);

  const lineColor = isPositive ? colors.success : colors.error;
  const gradientId = `areaGrad-${isPositive ? 'pos' : 'neg'}`;

  const coords = useMemo(
    () => buildCoords(prices, minPrice, maxPrice, plotLeft, plotTop, plotWidth, plotHeight),
    [prices, minPrice, maxPrice, plotLeft, plotTop, plotWidth, plotHeight],
  );

  const polylinePoints = useMemo(() => buildPolylinePoints(coords), [coords]);
  const areaPath = useMemo(() => buildAreaPath(coords, plotBottom), [coords, plotBottom]);

  // Y-axis grid lines and labels
  const yGridItems = useMemo(() => {
    const pad = (maxPrice - minPrice) * 0.08;
    const paddedMin = minPrice - pad;
    const paddedMax = maxPrice + pad;
    return Array.from({ length: Y_GRID_LINES }, (_, i) => {
      const frac = i / (Y_GRID_LINES - 1);
      const price = paddedMax - frac * (paddedMax - paddedMin);
      const y = plotTop + frac * plotHeight;
      return { price, y };
    });
  }, [minPrice, maxPrice, plotTop, plotHeight]);

  // X-axis label indices
  const labelIndices = useMemo(
    () => getLabelIndices(points.length, MAX_X_LABELS),
    [points.length],
  );

  // Indicator coords (same scale as main chart)
  const indicatorCoords = useMemo(
    () =>
      indicators.map(ind => ({
        ...ind,
        coords: buildCoords(
          ind.values,
          minPrice,
          maxPrice,
          plotLeft,
          plotTop,
          plotWidth,
          plotHeight,
        ).filter((_, i) => isFinite(ind.values[i])),
      })),
    [indicators, minPrice, maxPrice, plotLeft, plotTop, plotWidth, plotHeight],
  );

  // Touch interaction
  const handleTouchStart = useCallback(
    (evt: any) => {
      const x = evt.nativeEvent.locationX - plotLeft;
      const idx = Math.round((x / plotWidth) * (coords.length - 1));
      setActiveIndex(Math.max(0, Math.min(idx, coords.length - 1)));
    },
    [plotLeft, plotWidth, coords.length],
  );

  const handleTouchMove = useCallback(
    (evt: any) => {
      const x = evt.nativeEvent.locationX - plotLeft;
      const idx = Math.round((x / plotWidth) * (coords.length - 1));
      setActiveIndex(Math.max(0, Math.min(idx, coords.length - 1)));
    },
    [plotLeft, plotWidth, coords.length],
  );

  const handleTouchEnd = useCallback(() => setActiveIndex(null), []);

  // Active point data
  const activeCoord = activeIndex !== null ? coords[activeIndex] : null;
  const activePoint = activeIndex !== null ? points[activeIndex] : null;

  // Tooltip x positioning — keep it within the SVG
  const tooltipW = 100;
  const tooltipH = 36;
  const tooltipX =
    activeCoord !== null
      ? Math.max(
          plotLeft,
          Math.min(activeCoord.x - tooltipW / 2, width - tooltipW - 4),
        )
      : 0;
  const tooltipY = plotTop - 2;

  if (points.length < 2) {
    return (
      <View style={[s.empty, { height, borderColor: colors.border }]}>
        <Text style={[s.emptyText, { color: colors.textTertiary }]}>
          Not enough data for this period
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{ width, height: svgHeight + 4 }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleTouchStart}
      onResponderMove={handleTouchMove}
      onResponderRelease={handleTouchEnd}
      onResponderTerminate={handleTouchEnd}
    >
      <Svg width={width} height={svgHeight}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity={0.25} />
            <Stop offset="1" stopColor={lineColor} stopOpacity={0.0} />
          </LinearGradient>
        </Defs>

        {/* ── Y-axis grid lines ── */}
        {yGridItems.map(({ y, price }, i) => (
          <G key={`y-${i}`}>
            <Line
              x1={plotLeft}
              y1={y.toFixed(1)}
              x2={plotLeft + plotWidth}
              y2={y.toFixed(1)}
              stroke={colors.separator}
              strokeWidth={StyleSheet.hairlineWidth}
            />
            <SvgText
              x={plotLeft + plotWidth + 6}
              y={(y + 4).toFixed(1)}
              fill={colors.textTertiary}
              fontSize={10}
              textAnchor="start"
            >
              {price >= 1000
                ? price.toFixed(0)
                : price >= 100
                ? price.toFixed(1)
                : price.toFixed(2)}
            </SvgText>
          </G>
        ))}

        {/* ── Area fill ── */}
        <Path d={areaPath} fill={`url(#${gradientId})`} />

        {/* ── Indicator overlays (same price scale) ── */}
        {indicatorCoords.map(ind => (
          <Polyline
            key={ind.id}
            points={buildPolylinePoints(ind.coords)}
            stroke={ind.color}
            strokeWidth={ind.strokeWidth ?? 1}
            fill="none"
            strokeDasharray={ind.dashed ? '4,3' : undefined}
          />
        ))}

        {/* ── Main price line ── */}
        <Polyline
          points={polylinePoints}
          stroke={lineColor}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* ── X-axis labels ── */}
        {labelIndices.map(idx => {
          const coord = coords[idx];
          const label = formatAxisLabel(points[idx].date, period);
          const isFirst = idx === 0;
          const isLast = idx === points.length - 1;
          const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle';
          return (
            <SvgText
              key={`xl-${idx}`}
              x={coord.x.toFixed(1)}
              y={plotBottom + 16}
              fill={colors.textTertiary}
              fontSize={10}
              textAnchor={anchor}
            >
              {label}
            </SvgText>
          );
        })}

        {/* ── Touch crosshair ── */}
        {activeCoord && activePoint && (
          <G>
            {/* Vertical line */}
            <Line
              x1={activeCoord.x.toFixed(1)}
              y1={plotTop}
              x2={activeCoord.x.toFixed(1)}
              y2={plotBottom}
              stroke={colors.textTertiary}
              strokeWidth={1}
              strokeDasharray="3,3"
            />

            {/* Dot on the price line */}
            <Circle
              cx={activeCoord.x.toFixed(1)}
              cy={activeCoord.y.toFixed(1)}
              r={4}
              fill={lineColor}
              stroke={colors.background}
              strokeWidth={2}
            />

            {/* Tooltip bubble */}
            <Rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipW}
              height={tooltipH}
              rx={6}
              fill={colors.surface}
              stroke={colors.border}
              strokeWidth={0.5}
            />
            <SvgText
              x={tooltipX + tooltipW / 2}
              y={tooltipY + 13}
              fill={lineColor}
              fontSize={12}
              fontWeight="700"
              textAnchor="middle"
            >
              ${activePoint.price.toFixed(2)}
            </SvgText>
            <SvgText
              x={tooltipX + tooltipW / 2}
              y={tooltipY + 27}
              fill={colors.textTertiary}
              fontSize={9}
              textAnchor="middle"
            >
              {formatTooltipDate(activePoint.date)}
            </SvgText>
          </G>
        )}
      </Svg>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyText: { fontSize: 13 },
});
