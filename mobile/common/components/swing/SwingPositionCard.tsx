import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { SwingPosition } from '@/common/types/swing';
import { SWING_PROFILE_LABELS } from '@/common/types/swing';

interface Props {
  position: SwingPosition;
  onExit?: (position: SwingPosition) => void;
  onEditExits?: (position: SwingPosition) => void;
}

export function SwingPositionCard({ position, onExit, onEditExits }: Props) {
  const colors = useThemeColors();
  const sideColor = position.side === 'call' ? '#10B981' : '#EF4444';
  const pnl = (position.realized_pnl ?? 0) + (position.unrealized_pnl ?? 0);
  const pnlColor = pnl >= 0 ? '#10B981' : '#EF4444';
  const entryDate = new Date(position.entry_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const profileLabel = SWING_PROFILE_LABELS[position.strategy_profile] ?? position.strategy_profile;

  return (
    <View style={{
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{position.ticker}</Text>
            <View style={{ backgroundColor: sideColor + '22', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: sideColor, fontSize: 11, fontWeight: '700' }}>{position.side.toUpperCase()}</Text>
            </View>
            <View style={{ backgroundColor: position.mode === 'live' ? '#EF444422' : '#8B5CF622', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: position.mode === 'live' ? '#EF4444' : '#8B5CF6', fontSize: 11, fontWeight: '600' }}>
                {position.mode.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {position.contract_symbol} · {position.qty}x · In {entryDate} · {profileLabel}
          </Text>
        </View>

        {/* P&L */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: pnlColor, fontSize: 16, fontWeight: '700' }}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Total P&L</Text>
        </View>
      </View>

      {/* P&L detail row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
            ${position.entry_price?.toFixed(2)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Entry</Text>
        </View>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '600' }}>
            {position.realized_pnl >= 0 ? '+' : ''}{position.realized_pnl?.toFixed(2)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Realized</Text>
        </View>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: position.unrealized_pnl >= 0 ? '#10B981' : '#EF4444', fontSize: 12, fontWeight: '600' }}>
            {position.unrealized_pnl >= 0 ? '+' : ''}{position.unrealized_pnl?.toFixed(2)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Unrealized</Text>
        </View>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{position.qty}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Contracts</Text>
        </View>
      </View>

      {position.status !== 'closed' && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {onEditExits && (
            <TouchableOpacity
              onPress={() => onEditExits(position)}
              style={{
                flex: 1,
                backgroundColor: colors.surface,
                borderRadius: 8,
                padding: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Ionicons name="options-outline" size={14} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>Edit SL/TP</Text>
            </TouchableOpacity>
          )}
          {onExit && (
            <TouchableOpacity
              onPress={() => onExit(position)}
              style={{
                flex: 1,
                backgroundColor: '#EF444422',
                borderRadius: 8,
                padding: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#EF444444',
              }}
            >
              <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '600' }}>Close Position</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
