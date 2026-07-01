import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { SwingScore } from '@/common/types/swing';
import { TIER_COLORS } from '@/common/types/swing';

interface Props {
  item: SwingScore;
  onPress: (item: SwingScore) => void;
  onWatch?: (item: SwingScore) => void;
}

const fmt = (n: number, dec = 0) => n?.toLocaleString('en-US', { maximumFractionDigits: dec }) ?? '—';

export function SwingOpportunityCard({ item, onPress, onWatch }: Props) {
  const colors = useThemeColors();
  const isCandidate = item.tier === 'Candidate';
  const tierColor = TIER_COLORS[item.tier] ?? colors.textSecondary;
  const sideColor = item.side === 'call' ? '#10B981' : '#EF4444';
  const dollarFlow = item.dollar_flow >= 1_000_000
    ? `$${(item.dollar_flow / 1_000_000).toFixed(1)}M`
    : `$${(item.dollar_flow / 1_000).toFixed(0)}K`;
  const failReason = item.breakdown?.fail_reason;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      activeOpacity={0.78}
      style={{
        backgroundColor: colors.surface,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: isCandidate ? colors.border : colors.border,
        opacity: isCandidate ? 0.72 : 1,
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        {/* Tier badge */}
        <View style={{
          backgroundColor: tierColor + '22',
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 3,
          marginRight: 8,
          borderWidth: 1,
          borderColor: tierColor + '44',
        }}>
          <Text style={{ color: tierColor, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
            {isCandidate ? 'CANDIDATE' : item.tier.toUpperCase()}
          </Text>
        </View>

        {/* Ticker */}
        <Text style={{ color: isCandidate ? colors.textSecondary : colors.text, fontSize: 17, fontWeight: '700', flex: 1 }}>
          {item.ticker}
        </Text>

        {/* Score */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: isCandidate ? colors.textSecondary : colors.text, fontSize: 20, fontWeight: '800' }}>
            {item.composite_score.toFixed(0)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '500' }}>SCORE</Text>
        </View>
      </View>

      {/* Contract row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 }}>
        <View style={{
          backgroundColor: sideColor + '22',
          borderRadius: 5,
          paddingHorizontal: 7,
          paddingVertical: 2,
        }}>
          <Text style={{ color: sideColor, fontSize: 12, fontWeight: '700' }}>
            {item.side.toUpperCase()}
          </Text>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          ${item.strike} · {item.expiry} · {item.dte}d
        </Text>
        {item.is_sweep && (
          <View style={{ backgroundColor: '#F59E0B22', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={{ color: '#F59E0B', fontSize: 10, fontWeight: '600' }}>SWEEP</Text>
          </View>
        )}
        {item.is_floor && (
          <View style={{ backgroundColor: '#8B5CF622', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={{ color: '#8B5CF6', fontSize: 10, fontWeight: '600' }}>FLOOR</Text>
          </View>
        )}
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Stat label="Premium" value={`$${fmt(item.premium, 2)}`} colors={colors} />
        <Stat label="$ Flow" value={dollarFlow} colors={colors} />
        <Stat label="Vol/OI" value={item.vol_oi?.toFixed(2) ?? '—'} colors={colors} />
        <Stat label="IV" value={`${item.iv_pct?.toFixed(0) ?? '—'}%`} colors={colors} />
        <Stat label="UW Score" value={item.unusual_score?.toFixed(0) ?? '—'} colors={colors} accent={!isCandidate} />
      </View>

      {/* Mini score bars */}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
        <ScoreBar label="Setup" value={item.setup_score} color={isCandidate ? '#475569' : '#3B82F6'} colors={colors} />
        <ScoreBar label="Flow" value={item.flow_score} color={isCandidate ? '#475569' : '#10B981'} colors={colors} />
      </View>

      {/* Fail reason for candidates */}
      {isCandidate && failReason && (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="alert-circle-outline" size={12} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>{failReason}</Text>
          </View>
        </View>
      )}

      {/* Watch action — only for surfaced items */}
      {onWatch && !isCandidate && (
        <TouchableOpacity
          onPress={() => onWatch(item)}
          style={{ position: 'absolute', top: 14, right: 46 }}
        >
          <Ionicons name="bookmark-outline" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function Stat({ label, value, colors, accent = false }: { label: string; value: string; colors: ReturnType<typeof useThemeColors>; accent?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: accent ? colors.accent : colors.text, fontSize: 13, fontWeight: '600' }}>{value}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function ScoreBar({ label, value, color, colors }: { label: string; value: number; color: string; colors: ReturnType<typeof useThemeColors> }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: colors.textTertiary, fontSize: 10 }}>{label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 10 }}>{pct.toFixed(0)}</Text>
      </View>
      <View style={{ height: 3, backgroundColor: colors.border, borderRadius: 2 }}>
        <View style={{ height: 3, width: `${pct}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}
