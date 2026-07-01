import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ZeroDTEOpportunity } from '@/common/types/zero_dte';
import { TIER_CONFIG } from '@/common/types/zero_dte';
import { useThemeColors } from '@/lib/useColorScheme';

function fmt_dollars(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000)     return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

interface Props {
  item: ZeroDTEOpportunity;
  rank: number;
  onPress?: (item: ZeroDTEOpportunity) => void;
}

export function ZeroDTECard({ item, rank, onPress }: Props) {
  const colors = useThemeColors();
  const isCandidate = item.tier === 'CANDIDATE';
  const tier = TIER_CONFIG[item.tier] ?? TIER_CONFIG['CANDIDATE'];
  const isCall = item.contract_type === 'call';
  const sideColor = isCall ? '#10B981' : '#EF4444';

  return (
    <TouchableOpacity
      onPress={() => onPress?.(item)}
      activeOpacity={0.8}
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: colors.cardShadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 6,
        elevation: 2,
        opacity: isCandidate ? 0.72 : 1,
      }}
    >
      {/* ── Header: rank · ticker · tier ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700' }}>#{rank}</Text>
        </View>
        <Text style={{ color: isCandidate ? colors.textSecondary : colors.text, fontSize: 18, fontWeight: '700', flex: 1 }}>{item.ticker}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: tier.bg, gap: 4 }}>
          <Text style={{ fontSize: 12 }}>{tier.emoji}</Text>
          <Text style={{ color: tier.color, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>{tier.label}</Text>
        </View>
      </View>

      {/* ── Contract info ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Text style={{ color: sideColor, fontSize: 13, fontWeight: '700' }}>
          {isCall ? '▲ CALL' : '▼ PUT'}
        </Text>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>${item.strike.toFixed(0)}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>exp {item.expiry}</Text>
        <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {item.current_price > 0 && (
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
              SP ${item.current_price.toFixed(2)}
            </Text>
          )}
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
            {item.otm_pct.toFixed(1)}% OTM
          </Text>
        </View>
      </View>

      {/* ── Score bar ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <View style={{ flex: 1, height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 4, borderRadius: 2, width: `${item.composite_score}%`, backgroundColor: tier.color }} />
        </View>
        <Text style={{ color: tier.color, fontSize: 13, fontWeight: '700', minWidth: 36, textAlign: 'right' }}>
          {item.composite_score.toFixed(1)}
        </Text>
      </View>

      {/* ── Stat chips ── */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <StatChip label="Flow"  value={fmt_dollars(item.dollar_flow)} colors={colors} />
        <StatChip label="V/OI"  value={item.vol_oi.toFixed(2)} highlight={item.vol_oi > 0.5} colors={colors} />
        <StatChip label="IV"    value={`${item.iv_pct.toFixed(0)}%`} colors={colors} />
        <StatChip label="UW"    value={item.uw_score.toFixed(0)} colors={colors} />
        {item.above_vwap !== null && (
          <StatChip
            label="VWAP"
            value={item.above_vwap ? 'Above' : 'Below'}
            highlight={(isCall && item.above_vwap === true) || (!isCall && item.above_vwap === false)}
            colors={colors}
          />
        )}
      </View>

      {/* ── Tags + premium ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {item.is_sweep && (
          <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>SWEEP</Text>
          </View>
        )}
        {item.is_floor && (
          <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>FLOOR</Text>
          </View>
        )}
        {item.trend_aligned && (
          <View style={{ backgroundColor: colors.successBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.success + '44' }}>
            <Text style={{ color: colors.success, fontSize: 10, fontWeight: '700' }}>TREND ✓</Text>
          </View>
        )}
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginLeft: 'auto' }}>
          ${item.premium.toFixed(2)}/share · ${(item.premium * 100).toFixed(0)}/contract
        </Text>
      </View>

      {/* ── Fail reason for candidates ── */}
      {isCandidate && item.fail_reason && (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.separator, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="alert-circle-outline" size={12} color={colors.textTertiary} />
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>{item.fail_reason}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function StatChip({
  label, value, highlight, colors,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 9, marginBottom: 1 }}>{label}</Text>
      <Text style={{ color: highlight ? '#10B981' : colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
        {value}
      </Text>
    </View>
  );
}
