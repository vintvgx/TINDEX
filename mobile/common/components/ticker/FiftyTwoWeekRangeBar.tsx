import type React from 'react';
import { View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';

interface FiftyTwoWeekRangeBarProps {
  currentPrice: number;
  yearLow: number;
  yearHigh: number;
}

/**
 * Non-interactive status indicator (not a control) showing where the
 * current price sits within the 52-week range, matching the reference
 * design's "Near 52-week high/low" status line + track + dot.
 */
export const FiftyTwoWeekRangeBar: React.FC<FiftyTwoWeekRangeBarProps> = ({
  currentPrice,
  yearLow,
  yearHigh,
}) => {
  const colors = useThemeColors();
  const range = yearHigh - yearLow;
  const ratio = range > 0 ? Math.min(1, Math.max(0, (currentPrice - yearLow) / range)) : 0.5;

  let statusLabel = 'Mid-range';
  if (ratio >= 0.9) statusLabel = 'Near 52-week high';
  else if (ratio <= 0.1) statusLabel = 'Near 52-week low';

  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 15, fontWeight: '500' }}>52-Week Range</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 13, fontWeight: '500' }}>{statusLabel}</Text>
      </View>

      <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surfaceSecondary }}>
        <View
          style={{
            position: 'absolute',
            left: `${ratio * 100}%`,
            top: -6,
            width: 16,
            height: 16,
            borderRadius: 8,
            marginLeft: -8,
            backgroundColor: colors.accent,
            borderWidth: 2,
            borderColor: colors.background,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
        <Text style={{ color: colors.textTertiary, fontSize: 13, fontWeight: '500' }}>${yearLow.toFixed(2)}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 13, fontWeight: '500' }}>${yearHigh.toFixed(2)}</Text>
      </View>
    </View>
  );
};
