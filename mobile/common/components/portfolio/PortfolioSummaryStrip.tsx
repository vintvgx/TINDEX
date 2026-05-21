import { View, Text } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { usePlaidPortfolio } from '@/hooks/queries/plaid/usePlaidPortfolio';
import { usePortfolioPositionsQuery } from '@/hooks/queries/track/usePortfolioPositions';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PortfolioSummaryStrip() {
  const colors = useThemeColors();
  const { totalHoldingsValue, totalPnl, totalCostBasis, isLoading } = usePlaidPortfolio();
  const { data: manualPositions = [] } = usePortfolioPositionsQuery();

  const manualCostBasis = manualPositions.reduce(
    (sum, p) => sum + Number(p.shares) * Number(p.average_cost),
    0,
  );

  const pnlPct =
    totalPnl != null && totalCostBasis != null && totalCostBasis > 0
      ? (totalPnl / totalCostBasis) * 100
      : null;

  const pnlColor =
    totalPnl == null
      ? colors.textSecondary
      : totalPnl >= 0
        ? colors.success
        : colors.error;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 20,
        marginBottom: 24,
      }}
    >
      {/* Total holdings value */}
      <Text
        style={{
          color: colors.textSecondary,
          fontSize: 13,
          fontWeight: '500',
          marginBottom: 4,
        }}
      >
        Brokerage Value
      </Text>
      <Text
        style={{ color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }}
      >
        {isLoading ? '—' : totalHoldingsValue != null ? fmt(totalHoldingsValue) : '—'}
      </Text>

      {/* P&L row */}
      {(totalPnl != null || !isLoading) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
          }}
        >
          {totalPnl != null && (
            <>
              <View
                style={{
                  backgroundColor: totalPnl >= 0 ? colors.successBg : colors.errorBg,
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text style={{ color: pnlColor, fontSize: 13, fontWeight: '700' }}>
                  {totalPnl >= 0 ? '+' : ''}
                  {fmt(totalPnl)}
                  {pnlPct != null
                    ? `  (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`
                    : ''}
                </Text>
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>unrealized P&L</Text>
            </>
          )}
          {totalPnl == null && !isLoading && (
            <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
              Cost basis unavailable for P&L
            </Text>
          )}
        </View>
      )}

      {/* Divider + manual cost basis */}
      {manualCostBasis > 0 && (
        <View
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: colors.separator,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500' }}>
              Manual positions
            </Text>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 }}>
              {manualPositions.length} {manualPositions.length === 1 ? 'position' : 'positions'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500' }}>
              Cost basis
            </Text>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 }}>
              {fmt(manualCostBasis)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}
