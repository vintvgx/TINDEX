import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { useStrategyLivePrice, type LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useOrbRangesForTickers } from '@/hooks/queries/orb/useOrbRangesForTickers';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { getOrbStatus } from '@/common/utils/orb/getOrbStatus';
import { computeOrbRangeFromHistory } from '@/common/utils/orb/computeOrbRangeFromHistory';

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
 * The ticker-tape-styled strip for PriceChartFullScreen — same dark
 * colors.tape/tapeText/tapeUp/tapeDown palette and top-of-screen position as
 * the global TickerTape (see ui/TickerTape.tsx), positioned above the
 * header/back button the same way TickerTape sits above AppHeader elsewhere
 * in the app. Taller than the compact global tape (two lines instead of
 * one) since it's showing more per trade — ticker, live price,
 * above/below/in-range vs. today's ORB, total Live Equity (same
 * useAlpacaBothAccounts() state Live Positions reads), and today's live P&L.
 * Cycles vertically through every LIVE open trade every 8s — paper trades
 * are excluded, and there's no animation at all with 0 or 1 trade.
 */
export function LiveTradesTickerTape({ colors }: { colors: any }) {
  const { filteredPositions, liveByStrategy, handleLiveUpdate } = useLivePositionsData('live');
  const tickers = useMemo(
    () => Array.from(new Set(filteredPositions.map(p => p.ticker.toUpperCase()))),
    [filteredPositions],
  );

  const { livePrices } = useMarketStream(tickers, { enabled: tickers.length > 0 });
  const { data: orbRanges } = useOrbRangesForTickers(tickers);
  const { data: accounts } = useAlpacaBothAccounts();
  const account = accounts?.live;

  // Same calc as position.tsx's account bar: cash (from the slow account
  // poll, stable mid-trade) + the sum of every open live position's
  // mark-to-market value (falling back to static cost basis before a
  // position's first tick arrives). Today P&L is then this live equity
  // minus yesterday's close — NOT the raw account.pnl_today field, which
  // only refreshes every ~60s and is what caused this tape's number to
  // drift from what Live Positions shows.
  const liveDerivedEquity = useMemo(() => {
    if (!account?.available || filteredPositions.length === 0) return null;
    let sumMarketValue = 0;
    for (const pos of filteredPositions) {
      const live = liveByStrategy[pos.strategy_id];
      if (live?.market_value != null) {
        sumMarketValue += live.market_value;
      } else if (pos.entry_premium != null && pos.qty_remaining != null) {
        sumMarketValue += pos.entry_premium * pos.qty_remaining * 100;
      }
    }
    return account.cash + sumMarketValue;
  }, [account, filteredPositions, liveByStrategy]);

  const displayEquity = liveDerivedEquity ?? account?.equity ?? null;
  const displayPnlToday =
    liveDerivedEquity != null && account?.last_equity != null
      ? liveDerivedEquity - account.last_equity
      : account?.pnl_today ?? null;
  const displayPnlTodayPct =
    liveDerivedEquity != null && account?.last_equity
      ? (displayPnlToday! / account.last_equity) * 100
      : account?.pnl_today_pct ?? null;

  const [index, setIndex] = useState(0);
  // The open-trade list itself can shrink/grow (a position closes, a new one
  // opens) — clamp instead of resetting to 0 so an in-progress cycle doesn't
  // visually jump back to the first trade every time.
  useEffect(() => {
    setIndex(i => (tickers.length ? i % tickers.length : 0));
  }, [tickers.length]);

  useEffect(() => {
    if (tickers.length <= 1) return;
    const id = setInterval(() => {
      setIndex(i => (i + 1) % tickers.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [tickers.length]);

  const ticker = tickers[index % tickers.length] ?? '';

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

  if (tickers.length === 0) return null;

  const price = livePrices[ticker] ?? null;
  const orb = orbRanges?.[ticker] ?? computeOrbRangeFromHistory(historyResponse?.data);
  const range = price != null && orb ? rangeLabel(price, orb.orb_high, orb.orb_low, colors) : null;

  const equity = displayEquity;
  const pnlToday = displayPnlToday;
  const pnlTodayPct = displayPnlTodayPct;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.tape }]}>
      {/* Headless — feeds liveByStrategy above, nothing rendered. */}
      {filteredPositions.map(pos => (
        <LivePositionPnlSub key={pos.strategy_id} pos={pos} onUpdate={handleLiveUpdate} />
      ))}
      <View style={[styles.liveDot, { backgroundColor: colors.tapeUp }]} />
      <Animated.View style={[styles.content, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.row}>
          <Text style={[styles.ticker, { color: colors.tapeText }]} numberOfLines={1}>${ticker}</Text>
          {price != null && (
            <Text style={[styles.price, { color: colors.tapeText }]}>${price.toFixed(2)}</Text>
          )}
          {range && (
            <Text style={[styles.range, { color: range.color }]}>{range.text}</Text>
          )}
        </View>
        <View style={styles.row}>
          {equity != null && (
            <Text style={[styles.sub, { color: colors.tapeMuted }]}>
              Live Equity ${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8, overflow: 'hidden' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  content: { flex: 1, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 16 },
  ticker: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  price: { fontSize: 13, fontWeight: '600' },
  range: { fontSize: 12, fontWeight: '700' },
  sub: { fontSize: 11, fontWeight: '500' },
  dot: { fontSize: 11 },
});
