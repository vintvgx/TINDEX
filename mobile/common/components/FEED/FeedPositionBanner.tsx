import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useStrategyPositions, PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { useThemeColors } from '@/lib/useColorScheme';

const PROFILE_EMOJI: Record<string, string> = {
  BULL_DOG: '🐂', THUNDER_CAT: '🐱', WOLF: '🐺', CUSTOM: '⚙️',
};

function PositionChip({ pos, colors }: { pos: PositionEntry; colors: any }) {
  const pnl    = pos.unrealized_pnl ?? 0;
  const pnlPct = pos.unrealized_pnl_pct ?? 0;
  const isCall = pos.direction === 'CALL';
  const dirColor = isCall ? colors.success : colors.error;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;

  return (
    <View style={{
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 8,
      minWidth: 155,
      borderWidth: 1,
      borderColor: dirColor + '33',
    }}>
      {/* top row: emoji + name + direction badge */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <Text style={{ fontSize: 11 }}>{PROFILE_EMOJI[pos.profile] ?? '📊'}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '500', flex: 1 }} numberOfLines={1}>
          {pos.strategy_name || pos.ticker}
        </Text>
        <View style={{ backgroundColor: dirColor + '22', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
          <Text style={{ color: dirColor, fontSize: 9, fontWeight: '800' }}>{pos.direction}</Text>
        </View>
      </View>

      {/* contract */}
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600', marginBottom: 3 }} numberOfLines={1}>
        {pos.contract}
      </Text>

      {/* P&L */}
      <Text style={{ color: pnlColor, fontSize: 13, fontWeight: '800' }}>
        {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}{' '}
        <Text style={{ fontSize: 11, fontWeight: '600' }}>
          ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
        </Text>
      </Text>
    </View>
  );
}

export function FeedPositionBanner() {
  const colors = useThemeColors();
  const { data: positions, isLoading } = useStrategyPositions();

  const active = (positions ?? []).filter(p => p.active);

  const containerStyle = {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden' as const,
  };

  return (
    <View style={containerStyle}>
      {/* header */}
      <View style={{
        paddingHorizontal: 14,
        paddingTop: 11,
        paddingBottom: active.length > 0 ? 6 : 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}>
        <View style={{
          width: 6, height: 6, borderRadius: 3,
          backgroundColor: active.length > 0 ? colors.success : colors.textTertiary,
        }} />
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>
          Live Positions
        </Text>
        {active.length > 0 && (
          <View style={{ backgroundColor: colors.success + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: colors.success, fontSize: 10, fontWeight: '700' }}>
              {active.length} ACTIVE
            </Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : active.length === 0 ? (
        <Text style={{
          color: colors.textTertiary,
          fontSize: 12,
          paddingHorizontal: 14,
          paddingBottom: 11,
        }}>
          No active positions — waiting for next ORB breakout
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 14, paddingRight: 6, paddingBottom: 12 }}
        >
          {active.map(pos => (
            <PositionChip key={pos.strategy_id} pos={pos} colors={colors} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
