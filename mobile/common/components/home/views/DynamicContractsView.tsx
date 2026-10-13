import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useTrackedContractQuotes } from '@/hooks/queries/track/useTrackedContractQuotes';
import { useUntrackContract } from '@/hooks/mutations/track/useUntrackContract';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import { TradeContractSheet } from '@/common/components/ticker/TradeContractSheet';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { isOptionExpired } from '@/lib/marketHours';
import type { TrackedOptionContract } from '@/common/types/options';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';

/**
 * Dynamic card "watched" view: contracts you're tracking (not holding —
 * those are on the Open page, DynamicOpenContractsView). Tapping one opens
 * its contract window (OptionsContractDetailModal), same as the Track
 * screen, whose Trade button opens the entry sheet for that contract.
 *
 * Each row shows the price when tracking started → the price now, with the
 * change colored green/red (one batched quote poll, see
 * useTrackedContractQuotes). While the first quote loads the price shows a
 * spinner; a failed or empty quote shows "—". Expired contracts aren't
 * quoted or removed — they're labelled "Expired" for you to untrack.
 */

/** The price when tracking started — the snapshot's mid, the same basis as
 *  the live mark it's compared to (last trade / ask only when there's none). */
function trackedAtPrice(c: TrackedOptionContract): number | null {
  const s = c.tracking_snapshot ?? {};
  const p = [s.mark, s.lastPrice, s.ask].find((v) => typeof v === 'number' && v > 0);
  return p ?? null;
}

const fmt = (v: number) => `$${v.toFixed(2)}`;

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
export function DynamicContractsView({ visible = true }: {
  /** The card's current view — off-screen as a pager neighbor, quotes don't poll. */
  visible?: boolean;
} = {}) {
  const colors = useThemeColors();
  const { data: contracts, isLoading } = useTrackedContracts();
  const watched = (contracts ?? []).filter((c) => c.status === 'tracking' || c.status === 'entered');
  const live = watched.filter((c) => !isOptionExpired(c.expiration_date));
  const { data: quotes, isFetching: quotesFetching, isError: quotesFailed } =
    useTrackedContractQuotes(live.map((c) => c.contract_symbol), visible);
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
              const expired = isOptionExpired(c.expiration_date);
              const from = trackedAtPrice(c);
              const now = expired ? null : quotes?.[c.contract_symbol]?.mark ?? null;
              // First quote request in flight → spinner. Once it has answered
              // without this contract, or failed, → "—" (no spinner flashing
              // on every 15s poll for a contract Alpaca doesn't price).
              const loadingPrice = !expired && quotes === undefined && quotesFetching && !quotesFailed;
              const pct = from != null && now != null ? ((now - from) / from) * 100 : null;
              const pctColor = pct == null || Math.abs(pct) < 0.05
                ? colors.textSecondary
                : pct > 0 ? colors.success : colors.error;
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
                  {expired ? (
                    <View style={[styles.badge, { backgroundColor: colors.textTertiary + '22', borderColor: colors.textTertiary + '55' }]}>
                      <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: colors.textSecondary }]}>
                        EXPIRED
                      </Text>
                    </View>
                  ) : (
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>
                          {from != null ? fmt(from) : '—'} →{' '}
                        </Text>
                        {loadingPrice ? (
                          <ActivityIndicator size="small" color={colors.textTertiary} style={{ transform: [{ scale: 0.7 }] }} />
                        ) : (
                          <Text style={[styles.mono, { fontSize: 11, fontWeight: '800', color: now != null ? pctColor : colors.textTertiary }]}>
                            {now != null ? fmt(now) : '—'}
                          </Text>
                        )}
                      </View>
                      {pct != null && (
                        <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: pctColor }]}>
                          ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
                        </Text>
                      )}
                    </View>
                  )}
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
          liveContractPrice={quotes?.[selected.contract_symbol]?.mark ?? null}
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
function WatchedContractModal({ contract, liveContractPrice, onClose, onTrade }: {
  contract: TrackedOptionContract;
  liveContractPrice: number | null;
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
      trackedPrice={trackedAtPrice(contract)}
      liveContractPrice={liveContractPrice}
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
