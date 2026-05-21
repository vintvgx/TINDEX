import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePortfolioPositionsQuery } from '@/hooks/queries/track/usePortfolioPositions';
import { useDeletePortfolioPosition } from '@/hooks/mutations/portfolio/useDeletePortfolioPosition';
import { NewTradeModal, type NewTradePayload } from '@/common/components/track/NewTradeModal';
import { useUpsertPortfolioPosition } from '@/hooks/mutations/portfolio/useUpsertPortfolioPosition';
import type { PortfolioPosition } from '@/common/types/portfolio';

export function ManualPositionsSection() {
  const colors = useThemeColors();
  const [addModalOpen, setAddModalOpen] = useState(false);

  const { data: positions = [], isLoading, error } = usePortfolioPositionsQuery();
  const deleteMutation = useDeletePortfolioPosition();
  const upsertMutation = useUpsertPortfolioPosition();

  function handleDelete(pos: PortfolioPosition) {
    Alert.alert('Remove position', `Remove ${pos.ticker} from your portfolio?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate(pos.id) },
    ]);
  }

  async function handleAddSubmit(payload: NewTradePayload) {
    if (payload.type !== 'trade') {
      setAddModalOpen(false);
      return;
    }
    try {
      await upsertMutation.mutateAsync({
        ticker: payload.ticker,
        shares: payload.shares,
        average_cost: payload.pricePerShare,
        opened_at: payload.date,
      });
      setAddModalOpen(false);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save position');
    }
  }

  return (
    <View>
      {/* Section header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          Manual Positions
        </Text>
        <TouchableOpacity
          onPress={() => setAddModalOpen(true)}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: 12,
            paddingVertical: 7,
            backgroundColor: colors.iconButton,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.iconButtonBorder,
          }}
        >
          <Ionicons name="add" size={14} color={colors.text} />
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Add</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View
          style={{
            backgroundColor: colors.errorBg,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.error,
            padding: 14,
          }}
        >
          <Text style={{ color: colors.error, fontSize: 13 }}>Failed to load positions</Text>
        </View>
      ) : positions.length === 0 ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 20,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
            No manual positions yet. Tap Add to log a trade.
          </Text>
        </View>
      ) : (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
          }}
        >
          {positions.map((pos, idx) => (
            <View
              key={pos.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderTopWidth: idx === 0 ? 0 : 1,
                borderTopColor: colors.separator,
              }}
            >
              {/* Ticker badge */}
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  backgroundColor: colors.surfaceSecondary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: pos.ticker.length > 4 ? 9 : 11,
                    fontWeight: '700',
                    color: colors.text,
                  }}
                >
                  {pos.ticker}
                </Text>
              </View>

              {/* Info */}
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                  {pos.ticker}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
                  {Number(pos.shares)} sh · ${Number(pos.average_cost).toFixed(2)} avg
                </Text>
              </View>

              {/* Cost basis */}
              <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                  ${(Number(pos.shares) * Number(pos.average_cost)).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
                <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }}>
                  cost basis
                </Text>
              </View>

              {/* Delete */}
              <TouchableOpacity
                onPress={() => handleDelete(pos)}
                disabled={deleteMutation.isPending}
                hitSlop={8}
                activeOpacity={0.6}
              >
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <NewTradeModal
        visible={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        selectedDate={null}
        onSubmit={handleAddSubmit}
      />
    </View>
  );
}
