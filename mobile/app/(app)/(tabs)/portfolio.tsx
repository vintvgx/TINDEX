import { useCallback } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePlaidPortfolio } from '@/hooks/queries/plaid/usePlaidPortfolio';
import { useLinkedAccounts } from '@/hooks/queries/plaid/useLinkedAccounts';
import { usePortfolioPositionsQuery } from '@/hooks/queries/track/usePortfolioPositions';
import { useDeletePortfolioPosition } from '@/hooks/mutations/portfolio/useDeletePortfolioPosition';
import { AccountSection } from '@/common/components/portfolio/AccountSection';
import { ConnectBrokerageButton } from '@/common/components/plaid/ConnectBrokerageButton';
import type { PortfolioPosition } from '@/common/types/portfolio';

function fmt(n: number) {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export default function PortfolioScreen() {
  const colors = useThemeColors();
  const { groups, totalValue, totalPnl, isLoading, error, refetch } = usePlaidPortfolio();
  const { data: linkedAccounts } = useLinkedAccounts();
  const { data: manualPositions = [], isLoading: manualLoading } = usePortfolioPositionsQuery();
  const deletePosition = useDeletePortfolioPosition();

  const onRefresh = useCallback(() => { void refetch(); }, [refetch]);

  const hasLinked = (linkedAccounts?.length ?? 0) > 0;
  const hasBrokerageData = groups.length > 0;
  const pnlPositive = totalPnl != null && totalPnl >= 0;

  function confirmDelete(pos: PortfolioPosition) {
    Alert.alert('Remove position', `Remove ${pos.ticker} from manual positions?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deletePosition.mutate(pos.id) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 24, paddingVertical: 16,
        borderBottomWidth: 1, borderBottomColor: colors.separator,
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
      }}>
        <View>
          <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 }}>
            Portfolio
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500', marginTop: 2 }}>
            Holdings & positions
          </Text>
        </View>
        <ConnectBrokerageButton />
      </View>

      {/* Summary strip */}
      {(totalValue != null || totalPnl != null) && (
        <View style={{
          paddingHorizontal: 24, paddingVertical: 16,
          borderBottomWidth: 1, borderBottomColor: colors.separator,
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {totalValue != null && (
            <View>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500' }}>
                Brokerage value
              </Text>
              <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 }}>
                {fmt(totalValue)}
              </Text>
            </View>
          )}
          {totalPnl != null && (
            <View style={{
              paddingHorizontal: 14, paddingVertical: 8,
              backgroundColor: pnlPositive ? colors.successBg : colors.errorBg,
              borderRadius: 12,
              alignItems: 'flex-end',
            }}>
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '500' }}>
                Unrealized P&L
              </Text>
              <Text style={{
                color: pnlPositive ? colors.success : colors.error,
                fontSize: 18, fontWeight: '700', marginTop: 2,
              }}>
                {pnlPositive ? '+' : ''}{fmt(totalPnl)}
              </Text>
            </View>
          )}
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={onRefresh}
            tintColor={colors.textSecondary}
          />
        }
      >
        {/* ── Brokerage Holdings ─────────────────────────── */}
        <View style={{ marginBottom: 8 }}>
          <Text style={{
            color: colors.textSecondary, fontSize: 12, fontWeight: '700',
            textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
          }}>
            Brokerage Holdings
          </Text>

          {isLoading && !hasBrokerageData ? (
            <View style={{
              padding: 32, alignItems: 'center',
              backgroundColor: colors.surface, borderRadius: 16,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 12 }}>
                Loading holdings…
              </Text>
            </View>
          ) : error ? (
            <View style={{
              padding: 20, backgroundColor: colors.errorBg,
              borderRadius: 16, borderWidth: 1, borderColor: colors.error + '40',
            }}>
              <Text style={{ color: colors.error, fontSize: 14, fontWeight: '600' }}>
                Failed to load holdings
              </Text>
              <TouchableOpacity onPress={onRefresh} style={{ marginTop: 8 }}>
                <Text style={{ color: colors.accent, fontSize: 13 }}>Tap to retry</Text>
              </TouchableOpacity>
            </View>
          ) : !hasLinked ? (
            <View style={{
              padding: 24, alignItems: 'center', gap: 12,
              backgroundColor: colors.surface, borderRadius: 16,
              borderWidth: 1, borderColor: colors.border,
              borderStyle: 'dashed',
            }}>
              <Ionicons name="wallet-outline" size={32} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
                No brokerage connected
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center' }}>
                {'Tap "Connect Brokerage" above to import your holdings automatically.'}
              </Text>
            </View>
          ) : !hasBrokerageData ? (
            <View style={{
              padding: 24, alignItems: 'center',
              backgroundColor: colors.surface, borderRadius: 16,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
                No holdings found in linked accounts.
              </Text>
            </View>
          ) : (
            groups.map((group) => (
              <AccountSection key={group.account.account_id} group={group} />
            ))
          )}
        </View>

        {/* ── Manual Positions ───────────────────────────── */}
        <View style={{ marginTop: 20 }}>
          <Text style={{
            color: colors.textSecondary, fontSize: 12, fontWeight: '700',
            textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
          }}>
            Manual Positions
          </Text>

          {manualLoading ? (
            <View style={{
              padding: 24, alignItems: 'center',
              backgroundColor: colors.surface, borderRadius: 16,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : manualPositions.length === 0 ? (
            <View style={{
              padding: 24, alignItems: 'center',
              backgroundColor: colors.surface, borderRadius: 16,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
                No manual positions. Add one from the Track screen.
              </Text>
            </View>
          ) : (
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16,
              borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
            }}>
              {manualPositions.map((pos, i) => (
                <View key={pos.id}>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 16, paddingVertical: 13,
                  }}>
                    {/* Badge */}
                    <View style={{
                      width: 44, height: 44, borderRadius: 10,
                      backgroundColor: colors.surfaceSecondary,
                      alignItems: 'center', justifyContent: 'center', marginRight: 12,
                    }}>
                      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                        {pos.ticker.slice(0, 4)}
                      </Text>
                    </View>

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                        {pos.ticker}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
                        {Number(pos.shares)} sh · {fmt(Number(pos.average_cost))}/sh avg
                      </Text>
                    </View>

                    {/* Cost basis */}
                    <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                        {fmt(Number(pos.shares) * Number(pos.average_cost))}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 1 }}>
                        cost basis
                      </Text>
                    </View>

                    {/* Delete */}
                    <TouchableOpacity onPress={() => confirmDelete(pos)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                  {i < manualPositions.length - 1 && (
                    <View style={{ height: 1, backgroundColor: colors.separator, marginHorizontal: 16 }} />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
