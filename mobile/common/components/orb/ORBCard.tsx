import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { AnimatedNumber } from './AnimatedNumber';
import { GapTrendBadges } from './GapTrendBadges';
import type { GapTrendContext } from '@/common/types/orb';
import { useThemeColors } from '@/lib/useColorScheme';

export interface FlowSummary {
  callPct: number;
  putPct: number;
  totalAlerts: number;
  topUnusualScore: number;
}

interface ORBCardProps {
  data: ORBMonitoringState;
  onPress: () => void;
  orbRange?: GapTrendContext | null;
  fullWidth?: boolean;
  livePrice?: number | null;
  flowSummary?: FlowSummary | null;
}

const getBreakoutColor = (breakoutType: string, colors: ReturnType<typeof useThemeColors>): string => {
  switch (breakoutType) {
    case 'Bullish':
    case 'Confirmed Bullish': return colors.success;
    case 'Bearish':
    case 'Confirmed Bearish': return colors.error;
    case 'invalidated': return colors.warning;
    case 'reversal': return '#5856D6';
    case 'Offline': return colors.textTertiary;
    default: return colors.textSecondary;
  }
};

export const ORBCard: React.FC<ORBCardProps> = ({ data, onPress, orbRange, fullWidth = false, livePrice, flowSummary }) => {
  const colors = useThemeColors();

  const orbHigh = data.orb_high ?? 0;
  const orbLow = data.orb_low ?? 0;
  const currentPrice = livePrice ?? data.current_price ?? 0;
  const isAboveHigh = currentPrice > orbHigh;
  const isBelowLow = currentPrice < orbLow;
  const isInRange = !isAboveHigh && !isBelowLow && orbHigh - orbLow > 0;

  let priceColor = colors.text;
  if (isAboveHigh) priceColor = colors.success;
  else if (isBelowLow) priceColor = colors.error;
  else if (isInRange) priceColor = colors.textSecondary;

  const breakoutColor = getBreakoutColor(data.breakout_type, colors);
  const hasBreakout = data.breakout_type !== 'none';

  const showFlow = !!flowSummary && flowSummary.totalAlerts > 0;
  const flowBullish = showFlow && flowSummary!.callPct > flowSummary!.putPct;
  const flowPillColor = flowBullish ? colors.success : colors.error;
  const flowPillLabel = flowBullish
    ? `▲ CALL ${flowSummary!.callPct}%`
    : `▼ PUT ${flowSummary!.putPct}%`;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flex: 1,
        marginHorizontal: fullWidth ? 0 : 4,
        marginBottom: 12,
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: (colors as any).cardShadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      {/* Header: Ticker + breakout badge */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>
          {data.ticker}
        </Text>
        {hasBreakout && (
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 100,
                backgroundColor: breakoutColor + '18',
                borderWidth: 1,
                borderColor: breakoutColor + '40',
              }}
            >
              <Text style={{ color: breakoutColor, fontSize: 11, fontWeight: '700' }}>
                {data.breakout_type}
              </Text>
            </View>
            {data.breakout_type === 'reversal' && data.reversal_data?.confidence && (
              <Text style={{ color: breakoutColor + 'CC', fontSize: 11 }}>
                {data.reversal_data.confidence} Conf.
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Current Price */}
      <View style={{ marginBottom: 12 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '500', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Current Price
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <AnimatedNumber
            value={livePrice ?? data.current_price}
            format={(v) => `$${v.toFixed(2)}`}
            style={{ fontSize: 26, fontWeight: '800' }}
            color={priceColor}
          />
          {data.percentage_change != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ color: data.percentage_change >= 0 ? colors.success : colors.error, fontSize: 13 }}>
                {data.percentage_change >= 0 ? '▲' : '▼'}
              </Text>
              <AnimatedNumber
                value={data.percentage_change}
                format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
                style={{ fontSize: 14, fontWeight: '600' }}
                color={data.percentage_change >= 0 ? colors.success : colors.error}
              />
            </View>
          )}
        </View>
      </View>

      {/* Gap / trend badges */}
      {orbRange?.gap_direction != null && (
        <View style={{ marginBottom: 12 }}>
          <GapTrendBadges context={orbRange} compact />
        </View>
      )}

      {/* ORB Range */}
      <View style={{ borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>ORB High</Text>
          <AnimatedNumber
            value={data.orb_high}
            format={(v) => `$${v.toFixed(2)}`}
            style={{ fontSize: 14, fontWeight: '600' }}
            color={colors.success}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>ORB Low</Text>
          <AnimatedNumber
            value={data.orb_low}
            format={(v) => `$${v.toFixed(2)}`}
            style={{ fontSize: 14, fontWeight: '600' }}
            color={colors.error}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {data.percentage_change != null && data.breakout_type === 'none' ? 'Prev. Close' : 'Opening'}
          </Text>
          <AnimatedNumber
            value={data.percentage_change != null && data.breakout_type === 'none' ? data.previous_close : data.opening_price}
            format={(v) => `$${v.toFixed(2)}`}
            style={{ fontSize: 14, fontWeight: '500' }}
            color={colors.textSecondary}
          />
        </View>
      </View>

      {/* Breakout price */}
      {hasBreakout && data.breakout_price != null && (
        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.separator }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Breakout Price</Text>
            <AnimatedNumber
              value={data.breakout_price}
              format={(v) => `$${v.toFixed(2)}`}
              style={{ fontSize: 14, fontWeight: '600' }}
              color={breakoutColor}
            />
          </View>
        </View>
      )}

      {/* Flow summary strip */}
      {showFlow && (
        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '500' }}>⚡ Flow</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 20,
                backgroundColor: flowPillColor + '18',
                borderWidth: 1,
                borderColor: flowPillColor + '40',
              }}>
                <Text style={{ color: flowPillColor, fontSize: 11, fontWeight: '700' }}>
                  {flowPillLabel}
                </Text>
              </View>
              {flowSummary!.topUnusualScore > 70 && (
                <View style={{
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  borderRadius: 20,
                  backgroundColor: colors.accent + '18',
                  borderWidth: 1,
                  borderColor: colors.accent + '40',
                }}>
                  <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>
                    {Math.round(flowSummary!.topUnusualScore)} UW
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
};
