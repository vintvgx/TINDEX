import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useUntrackContract } from '@/hooks/mutations/track/useUntrackContract';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import { TradeContractSheet } from '@/common/components/ticker/TradeContractSheet';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { TrackedOptionContract } from '@/common/types/options';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';

/**
 * Dynamic card "watched" view: contracts you're tracking (not holding —
 * those are on the Open page, DynamicOpenContractsView). Tapping one opens
 * its contract window (OptionsContractDetailModal), same as the Track
 * screen, whose Trade button opens the entry sheet for that contract.
 */

/**
 * The trade sheet wants an OptionsContract with a CURRENT bid/ask (it sizes
 * the default qty and shows cost from `ask`). A watched contract's
 * tracking_snapshot holds the quote from when it was tracked — possibly
 * days old — so fetch a live quote first (same endpoint the swing screens
 * use, already OptionsContract-shaped) and fall back to the snapshot only
 * if that fails. The order itself is priced live server-side either way.
 */
async function liveContractFor(c: TrackedOptionContract): Promise<OptionsContract> {
  try {
    const res = await fetch(`${RAILWAY_BASE_URL}/swing/contract/${encodeURIComponent(c.contract_symbol)}/quote`);
    const json = await res.json();
    if (res.ok && json?.success && json.data) return json.data as OptionsContract;
  } catch {
    // fall through to the snapshot
  }
  const s = c.tracking_snapshot ?? {};
  return {
    symbol: c.contract_symbol,
    ticker: c.ticker,
    strike: c.strike,
    expiration: c.expiration_date,
    option_type: c.option_type,
    bid: s.bid ?? 0,
    ask: s.ask ?? s.mark ?? 0,
    last_price: s.lastPrice ?? null,
    delta: s.delta ?? null,
    gamma: s.gamma ?? null,
    theta: s.theta ?? null,
    vega: s.vega ?? null,
    rho: null,
    implied_volatility: s.impliedVolatility ?? null,
    open_interest: s.openInterest ?? 0,
    volume: s.volume ?? 0,
    timestamp: new Date().toISOString(),
  };
}
export function DynamicContractsView() {
  const colors = useThemeColors();
  const { data: contracts, isLoading } = useTrackedContracts();
  const watched = (contracts ?? []).filter((c) => c.status === 'tracking' || c.status === 'entered');
  const [selected, setSelected] = useState<TrackedOptionContract | null>(null);
  const [trade, setTrade] = useState<{ contract: OptionsContract; ticker: string; price: number } | null>(null);

  const startTrade = async (c: TrackedOptionContract, underlyingPrice: number) => {
    const contract = await liveContractFor(c);
    setSelected(null);
    // iOS can't present a second native Modal while the first is still
    // animating closed — wait for the detail modal's dismiss (same as
    // options.tsx's handleTradePress).
    setTimeout(() => setTrade({ contract, ticker: c.ticker, price: underlyingPrice }), 350);
  };

  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
            WATCHED CONTRACTS
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
            {watched.length} WATCHING
          </Text>
        </View>

        {isLoading ? (
          <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16 }}>Loading contracts…</Text>
        ) : watched.length === 0 ? (
          <View style={{ marginTop: 20, alignItems: 'center', gap: 8 }}>
            <Ionicons name="eye-outline" size={28} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center' }}>
              No watched contracts.
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: 6 }}>
            {watched.map((c) => {
              const up = c.option_type === 'CALL';
              const dirColor = up ? colors.success : colors.error;
              return (
                <TouchableOpacity
                  key={c.id}
                  activeOpacity={0.7}
                  onPress={() => setSelected(c)}
                  style={[styles.row, { borderColor: colors.border }]}
                  accessibilityLabel={`${c.ticker} ${c.strike} ${c.option_type} contract`}
                >
                  <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: colors.text }]}>
                    {c.ticker}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
                    <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: dirColor }]}>
                      {c.option_type}
                    </Text>
                  </View>
                  <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>
                    {c.strike} · {c.expiration_date}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {selected && (
        <WatchedContractModal
          contract={selected}
          onClose={() => setSelected(null)}
          onTrade={(price) => startTrade(selected, price)}
        />
      )}
      {trade && (
        <TradeContractSheet
          visible
          onClose={() => setTrade(null)}
          colors={colors}
          ticker={trade.ticker}
          contract={trade.contract}
          currentPrice={trade.price}
        />
      )}
    </>
  );
}

/** Mounted only while open, so the ticker quote is fetched on demand. */
function WatchedContractModal({ contract, onClose, onTrade }: {
  contract: TrackedOptionContract;
  onClose: () => void;
  onTrade: (underlyingPrice: number) => void;
}) {
  const { data: tickerResp } = useTickerQuery(contract.ticker);
  const untrack = useUntrackContract();
  const snapshot = contract.tracking_snapshot ?? null;
  const underlying = tickerResp?.data?.current_price ?? 0;
  return (
    <OptionsContractDetailModal
      visible
      onClose={onClose}
      contract={snapshot}
      ticker={contract.ticker}
      currentPrice={underlying}
      onTrade={() => onTrade(underlying)}
      isTracked
      trackedPrice={snapshot?.lastPrice ?? null}
      onUntrackContract={() => untrack.mutate(contract.id, { onSuccess: onClose })}
      isUntracking={untrack.isPending}
    />
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
});
