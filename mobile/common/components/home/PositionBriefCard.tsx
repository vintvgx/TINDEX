import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';

/**
 * 0.7 redesign position card — the "Watchlist · Tindex" brief-card treatment
 * for an open position: ticker + direction badge, PnL hero (instead of the
 * setup-score gauge), entry → now, contract line, and invalidation.
 * Tap opens the ticker; X opens the exit sheet.
 */
export function PositionBriefCard({
  pos,
  colors,
  onLiveUpdate,
}: {
  pos: PositionEntry;
  colors: ReturnType<typeof useThemeColors>;
  onLiveUpdate: (strategyId: string, data: LivePriceData | null) => void;
}) {
  const { toTicker } = useBaseNavigation();
  const { data: live } = useStrategyLivePrice(pos.strategy_id, pos.active);
  const [exitOpen, setExitOpen] = useState(false);

  // Keep the parent's account-bar equity in sync with live ticks.
  useEffect(() => {
    onLiveUpdate(pos.strategy_id, live);
  }, [pos.strategy_id, live, onLiveUpdate]);
  useEffect(() => {
    return () => onLiveUpdate(pos.strategy_id, null);
  }, [pos.strategy_id, onLiveUpdate]);

  const dirUp = pos.direction === 'CALL';
  const dirColor = dirUp ? colors.success : colors.error;

  const entryPremium = live?.entry_premium ?? pos.entry_premium;
  const nowPremium = live?.mid_price ?? pos.current_price;
  const qty = live?.qty_remaining ?? pos.qty_remaining ?? 0;
  const pnl = live?.pnl ?? pos.unrealized_pnl ?? 0;
  const pnlPct = live?.pnl_pct ?? pos.unrealized_pnl_pct;
  const pnlUp = pnl >= 0;
  const pnlColor = pnlUp ? colors.success : colors.error;
  const hardStop = live?.hard_stop ?? pos.hard_stop;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => toTicker(pos.ticker)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
    >
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.mono, { fontSize: 17, fontWeight: '800', color: colors.text }]}>
          {pos.ticker}
        </Text>
        {pos.direction && (
          <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
            <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: dirColor }]}>
              {pos.direction}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
          {qty > 0 ? `${qty} × ` : ''}{pos.contract ? shortContract(pos.contract) : 'shares'}
        </Text>
        <TouchableOpacity
          onPress={() => setExitOpen(true)}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityLabel={`Close ${pos.ticker} position`}
        >
          <Ionicons name="close" size={15} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* PnL hero */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
        <Text style={[styles.mono, { fontSize: 26, fontWeight: '800', color: pnlColor }]}>
          {pnlUp ? '+' : ''}${pnl.toFixed(2)}
        </Text>
        {pnlPct != null && (
          <View style={[styles.badge, { backgroundColor: pnlColor + '1E', borderColor: pnlColor + '44' }]}>
            <Text style={[styles.mono, { fontSize: 11, fontWeight: '800', color: pnlColor }]}>
              {pnlUp ? '+' : ''}{pnlPct.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>

      {/* entry → now */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>
          {entryPremium != null ? `$${entryPremium.toFixed(2)}` : '—'}
        </Text>
        <Ionicons name="arrow-forward" size={12} color={colors.textTertiary} />
        <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', color: colors.text }]}>
          {nowPremium != null ? `$${nowPremium.toFixed(2)}` : '—'}
        </Text>
        {pos.paper_mode && (
          <View style={[styles.badge, { backgroundColor: colors.warning + '1E', borderColor: colors.warning + '44', marginLeft: 4 }]}>
            <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: colors.warning }]}>PAPER</Text>
          </View>
        )}
      </View>

      {/* invalidation */}
      {hardStop != null && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'flex-start' }}>
          <Ionicons name="shield-outline" size={13} color={colors.error} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.textSecondary, lineHeight: 16 }}>
            <Text style={{ fontWeight: '700', color: colors.error }}>Invalidation: </Text>
            below ${hardStop.toFixed(2)}
          </Text>
        </View>
      )}

      <ExitTradeModal
        visible={exitOpen}
        colors={colors}
        strategyId={pos.strategy_id}
        ticker={pos.ticker}
        contract={live?.contract ?? pos.contract}
        qtyRemaining={live?.qty_remaining ?? pos.qty_remaining ?? 1}
        paperMode={pos.paper_mode}
        onClose={() => setExitOpen(false)}
      />
    </TouchableOpacity>
  );
}

/** "AMZN251002C00252500" → "252.50C 10/02" (best-effort). */
function shortContract(symbol: string): string {
  const m = symbol.match(/^[A-Z]+(\d{6})([CP])(\d{8})$/);
  if (!m) return symbol;
  const [, yymmdd, cp, strike] = m;
  const s = (Number(strike) / 1000).toFixed(2).replace(/\.?0+$/, '');
  return `${s}${cp} ${yymmdd.slice(2, 4)}/${yymmdd.slice(4, 6)}`;
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
