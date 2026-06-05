import React from 'react';
import { View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import type { FlowSummary } from '@/common/types/flow';
import { formatPremium } from '@/common/types/flow';

interface FlowSummaryBarProps {
  summary: FlowSummary;
}

export const FlowSummaryBar: React.FC<FlowSummaryBarProps> = ({ summary }) => {
  const colors = useThemeColors();

  const { callPremium, putPremium, callCount, putCount, bias, biasStrength } = summary;
  const total = callPremium + putPremium;
  const callPct = total > 0 ? (callPremium / total) * 100 : 50;

  const biasColor =
    bias === 'Bullish' ? colors.success :
    bias === 'Bearish' ? colors.error :
    colors.textTertiary;

  return (
    <View style={{
      marginHorizontal: 16,
      marginBottom: 12,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    }}>
      {/* Bias indicator row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>
            Flow Bias
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: biasColor,
            }} />
            <Text style={{ color: biasColor, fontSize: 18, fontWeight: '800' }}>
              {bias}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '500' }}>
              {biasStrength}%
            </Text>
          </View>
        </View>

        {/* Total premium */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>
            Total Premium
          </Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            {formatPremium(total)}
          </Text>
        </View>
      </View>

      {/* Call / Put ratio bar */}
      <View style={{ height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', marginBottom: 8 }}>
        <View style={{ flex: callPct, backgroundColor: colors.success }} />
        <View style={{ flex: 100 - callPct, backgroundColor: colors.error }} />
      </View>

      {/* Call vs Put labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>
            Calls {callPct.toFixed(0)}%
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {formatPremium(callPremium)} · {callCount} alerts
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.error, fontSize: 12, fontWeight: '700' }}>
            Puts {(100 - callPct).toFixed(0)}%
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {formatPremium(putPremium)} · {putCount} alerts
          </Text>
        </View>
      </View>
    </View>
  );
};
