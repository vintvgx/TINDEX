import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { useStrategyLivePrice, type LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import type { AlpacaAccount } from '@/common/types/strategy';
import { useOrbRangesForTickers } from '@/hooks/queries/orb/useOrbRangesForTickers';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { getOrbStatus } from '@/common/utils/orb/getOrbStatus';
import { computeOrbRangeFromHistory } from '@/common/utils/orb/computeOrbRangeFromHistory';

// Same PAPER tint used everywhere else a live/paper trade needs to be told
// apart at a glance (PositionCard, PendingConfirmationCard/Modal).
const PAPER_COLOR = '#FF9F0A';

/**
 * Headless per-position live-tick subscriber — reports every mark-to-market
 * tick up via onUpdate, same mechanism PositionRow uses internally (see
 * LivePositionsSection.tsx), but with no UI of its own. Needed because this
 * tape doesn't render position rows, yet still has to feed the exact same
 * cash + sum(live market_value) equity calc position.tsx's account bar
 * uses — otherwise its Today P&L silently drifts from the slower ~60s
 * account-level poll instead of matching what Live Positions shows.
 */
function LivePositionPnlSub({
  pos, onUpdate,
}: {
  pos: PositionEntry;
  onUpdate: (strategyId: string, data: LivePriceData | null) => void;
}) {
  const { data: live } = useStrategyLivePrice(pos.strategy_id, pos.active);
  useEffect(() => {
    onUpdate(pos.strategy_id, live);
  }, [pos.strategy_id, live, onUpdate]);
  useEffect(() => {
    return () => onUpdate(pos.strategy_id, null);
  }, [pos.strategy_id, onUpdate]);
  return null;
}

const CYCLE_MS = 8000;
const TRANSITION_MS = 350;

function rangeLabel(price: number, orbHigh: number, orbLow: number, colors: any): { text: string; color: string } {
  const status = getOrbStatus(price, orbHigh, orbLow);
  if (status === 'in-range') return { text: '(IR)', color: colors.tapeText };
  // Points/% beyond whichever ORB boundary was crossed — how far above ORH
  // (or below ORL) the price currently sits, not the day's raw price change.
  const boundary = status === 'above' ? orbHigh : orbLow;
  const points = price - boundary;
  const pct = boundary !== 0 ? (points / boundary) * 100 : 0;
  const sign = points >= 0 ? '+' : '';
  return {
    text: `${sign}${points.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,
    color: status === 'above' ? colors.tapeUp : colors.tapeDown,
  };
}

/**
 * Same calc as position.tsx's account bar: cash (from the slow account
 * poll, stable mid-trade) + the sum of every open position's mark-to-market
 * value (falling back to static cost basis before a position's first tick
 * arrives). Today P&L is then this derived equity minus yesterday's close —
 * NOT the raw account.pnl_today field, which only refreshes every ~60s and
 * is what caused this tape's number to drift from what Live/Paper Positions
 * shows. Used once for the live account and once for paper — same math,
 * different account + position set.
 */
function useDerivedEquity(
  account: (AlpacaAccount & { available: boolean }) | undefined,
  positions: PositionEntry[],
  liveByStrategy: Record<string, LivePriceData | null>,
) {
  const derivedEquity = useMemo(() => {
    if (!account?.available || positions.length === 0) return null;
    let sumMarketValue = 0;
    for (const pos of positions) {
      const live = liveByStrategy[pos.strategy_id];
      if (live?.market_value != null) {
        sumMarketValue += live.market_value;
      } else if (pos.entry_premium != null && pos.qty_remaining != null) {
        sumMarketValue += pos.entry_premium * pos.qty_remaining * 100;
      }
    }
    return account.cash + sumMarketValue;
  }, [account, positions, liveByStrategy]);

  const equity = derivedEquity ?? account?.equity ?? null;
  const pnlToday =
    derivedEquity != null && account?.last_equity != null
      ? derivedEquity - account.last_equity
      : account?.pnl_today ?? null;
  const pnlTodayPct =
    derivedEquity != null && account?.last_equity
      ? (pnlToday! / account.last_equity) * 100
      : account?.pnl_today_pct ?? null;

  return { equity, pnlToday, pnlTodayPct };
}

type ModeEntry = { ticker: string; mode: 'live' | 'paper' };

/**
 * The ticker-tape-styled strip for PriceChartFullScreen — same dark
 * colors.tape/tapeText/tapeUp/tapeDown palette and top-of-screen position as
 * the global TickerTape (see ui/TickerTape.tsx), positioned above the
 * header/back button the same way TickerTape sits above AppHeader elsewhere
 * in the app. Taller than the compact global tape (two lines instead of
 * one) since it's showing more per trade — mode (live/paper), ticker, live
 * price, above/below/in-range vs. today's ORB, that account's total equity
 * (same useAlpacaBothAccounts() state Live/Paper Positions reads), and
 * today's live P&L for whichever account the currently-shown trade belongs
 * to. Cycles vertically through every open trade — live AND paper — every
 * 8s, with no animation at all with 0 or 1 trade total.
 */
export function LiveTradesTickerTape({ colors }: { colors: any }) {
  const live = useLivePositionsData('live');
  const paper = useLivePositionsData('paper');

  const entries = useMemo<ModeEntry[]>(() => {
    const liveTickers = Array.from(new Set(live.filteredPositions.map(p => p.ticker.toUpperCase())));
    const paperTickers = Array.from(new Set(paper.filteredPositions.map(p => p.ticker.toUpperCase())));
    return [
      ...liveTickers.map(ticker => ({ ticker, mode: 'live' as const })),
      ...paperTickers.map(ticker => ({ ticker, mode: 'paper' as const })),
    ];
  }, [live.filteredPositions, paper.filteredPositions]);

  const allTickers = useMemo(
    () => Array.from(new Set(entries.map(e => e.ticker))),
    [entries],
  );

  const { livePrices } = useMarketStream(allTickers, { enabled: allTickers.length > 0 });
  const { data: orbRanges } = useOrbRangesForTickers(allTickers);
  const { data: accounts } = useAlpacaBothAccounts();

  const liveEquity = useDerivedEquity(accounts?.live, live.filteredPositions, live.liveByStrategy);
  const paperEquity = useDerivedEquity(accounts?.paper, paper.filteredPositions, paper.liveByStrategy);

  const [index, setIndex] = useState(0);
  // The open-trade list itself can shrink/grow (a position closes, a new one
  // opens) — clamp instead of resetting to 0 so an in-progress cycle doesn't
  // visually jump back to the first trade every time.
  useEffect(() => {
    setIndex(i => (entries.length ? i % entries.length : 0));
  }, [entries.length]);

  useEffect(() => {
    if (entries.length <= 1) return;
    const id = setInterval(() => {
      setIndex(i => (i + 1) % entries.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [entries.length]);

  const current = entries[index % entries.length];
  const ticker = current?.ticker ?? '';
  const mode = current?.mode ?? 'live';

  // 1D history for whichever ticker is currently showing — only actually
  // used when useOrbRangesForTickers has no row for it (see
  // computeOrbRangeFromHistory above). Cheap: if this is also the ticker the
  // main chart is already showing, React Query serves it straight from
  // cache under the same ['ticker-history', ticker, '1D'] key.
  const { data: historyResponse } = useTickerHistoryQuery(ticker, '1D');

  // Vertical slide-up + fade on every index change — the "animate
  // vertically" ask, replacing the horizontal marquee style used elsewhere.
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    translateY.setValue(10);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: TRANSITION_MS, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: TRANSITION_MS, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  if (entries.length === 0) return null;

  const price = livePrices[ticker] ?? null;
  const orb = orbRanges?.[ticker] ?? computeOrbRangeFromHistory(historyResponse?.data);
  const range = price != null && orb ? rangeLabel(price, orb.orb_high, orb.orb_low, colors) : null;

  const { equity, pnlToday, pnlTodayPct } = mode === 'live' ? liveEquity : paperEquity;
  const modeColor = mode === 'live' ? colors.tapeUp : PAPER_COLOR;
  const equityLabel = mode === 'live' ? 'Live Equity' : 'Paper Equity';

  return (
    <View style={[styles.wrap, { backgroundColor: colors.tape }]}>
      {/* Headless — feeds liveByStrategy above, nothing rendered. */}
      {live.filteredPositions.map(pos => (
        <LivePositionPnlSub key={`live-${pos.strategy_id}`} pos={pos} onUpdate={live.handleLiveUpdate} />
      ))}
      {paper.filteredPositions.map(pos => (
        <LivePositionPnlSub key={`paper-${pos.strategy_id}`} pos={pos} onUpdate={paper.handleLiveUpdate} />
      ))}
      <View style={[styles.liveDot, { backgroundColor: modeColor }]} />
      <View style={styles.content}>
        {/* Only this row animates on cycle — ticker/price/range are what
            actually changes between trades. Account info below stays put. */}
        <Animated.View style={[styles.row, { opacity, transform: [{ translateY }] }]}>
          <Text style={[styles.modeLabel, { color: modeColor }]}>{mode === 'live' ? 'LIVE' : 'PAPER'}</Text>
          <Text style={[styles.ticker, { color: colors.tapeText }]} numberOfLines={1}>${ticker}</Text>
          {price != null && (
            <Text style={[styles.price, { color: colors.tapeText }]}>${price.toFixed(2)}</Text>
          )}
          {range && (
            <Text style={[styles.range, { color: range.color }]}>{range.text}</Text>
          )}
        </Animated.View>
        {/* Sticky — the account this trade belongs to still changes when
            cycling live→paper, but the value swaps in place, no slide/fade. */}
        <View style={styles.row}>
          {equity != null && (
            <Text style={[styles.sub, { color: colors.tapeMuted }]}>
              {equityLabel} ${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          )}
          {pnlToday != null && (
            <>
              <Text style={[styles.dot, { color: colors.tapeMuted }]}>•</Text>
              <Text style={[styles.sub, { color: pnlToday >= 0 ? colors.tapeUp : colors.tapeDown }]}>
                {pnlToday >= 0 ? '+' : ''}${pnlToday.toFixed(2)}
                {pnlTodayPct != null ? ` (${pnlToday >= 0 ? '+' : ''}${pnlTodayPct.toFixed(2)}%)` : ''} today
              </Text>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8, overflow: 'hidden' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  content: { flex: 1, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 16 },
  modeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  ticker: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  price: { fontSize: 13, fontWeight: '600' },
  range: { fontSize: 12, fontWeight: '700' },
  sub: { fontSize: 11, fontWeight: '500' },
  dot: { fontSize: 11 },
});
