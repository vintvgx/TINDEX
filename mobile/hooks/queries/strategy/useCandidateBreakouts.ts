import { useMemo } from 'react';
import { useStrategyConfigs } from '@/hooks/queries/strategy/useStrategyConfigs';
import { useORBMonitoringState, type ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { usePendingConfirmations } from '@/hooks/queries/strategy/usePendingConfirmations';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useSkippedCandidates, candidateKey } from '@/hooks/useSkippedCandidates';
import type { ProfileKey } from '@/common/types/strategy';

export interface CandidateBreakout {
  key: string;
  strategyId: string;
  ticker: string;
  direction: 'CALL' | 'PUT';
  profile: ProfileKey;
  strategyName: string;
  confirmEntry: boolean;
  confirmDeadline: string | null;
  orbHigh: number;
  orbLow: number;
  currentPrice: number | null;
  tradeDate: string;
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Live-only candidate breakout detection for the Dashboard's "Pending &
 * Awaiting Confirmation" section — see candidate-breakout-design.html.
 * Deliberately client-derived: reuses breakout_type + confirm_deadline
 * already flowing through orb_monitoring_state instead of a new backend
 * "candidate" record, so a breakout that just retests and dies never costs
 * a real contract lookup or capital check.
 *
 * One entry per (strategy config, ticker, direction) — a ticker watched by
 * two live profiles can show two candidate cards, since confirm_entry and
 * contract selection are per-config. Paper strategies are excluded
 * entirely: they run their own independent flow with no candidate-card
 * involvement (2026-08-04 decision — see the design doc's paper/live
 * section for why mirroring was rejected).
 *
 * A candidate disappears (simply stops being returned here) the instant
 * any of these happen, matching the state machine in the design doc:
 *  - price retests back inside the ORB range (breakout_type moves off
 *    'Bullish'/'Bearish' to 'Retesting …'/'invalidated'/'none' before this
 *    hook ever needs to know why — it just stops matching the filter below)
 *  - the hold clears and confirm_entry=false, so the trade auto-enters
 *    (breakout_type moves to 'Confirmed …')
 *  - the hold clears and confirm_entry=true, producing a REAL
 *    orb_pending_confirmations row — at that point the existing Awaiting
 *    Confirmation card takes over, and this hook excludes it to avoid
 *    showing the same signal twice
 *  - the user taps Skip (useSkippedCandidates, client-only, no backend call)
 */
export function useCandidateBreakouts() {
  const { data: configs, isLoading: configsLoading } = useStrategyConfigs();
  const { data: monitoringState, isLoading: monitoringLoading } = useORBMonitoringState();
  const { data: pendingConfirmations } = usePendingConfirmations();
  const { isSkipped, skip } = useSkippedCandidates();

  const tradeDate = todayISODate();

  const liveConfigs = useMemo(
    () => (configs ?? []).filter(c => c.active && !c.paper_mode),
    [configs],
  );

  const monitoringByTicker = useMemo(() => {
    const m = new Map<string, ORBMonitoringState>();
    for (const row of (monitoringState ?? [])) m.set(row.ticker, row);
    return m;
  }, [monitoringState]);

  const pendingStrategyIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of (pendingConfirmations ?? [])) s.add(p.strategy_id);
    return s;
  }, [pendingConfirmations]);

  const rawCandidates = useMemo<CandidateBreakout[]>(() => {
    const out: CandidateBreakout[] = [];
    for (const cfg of liveConfigs) {
      const row = monitoringByTicker.get(cfg.ticker);
      if (!row) continue;

      const direction: 'CALL' | 'PUT' | null =
        row.breakout_type === 'Bullish' ? 'CALL'
        : row.breakout_type === 'Bearish' ? 'PUT'
        : null;
      if (!direction) continue;
      if (row.orb_high == null || row.orb_low == null) continue;

      const key = candidateKey(cfg.id, cfg.ticker, direction, tradeDate);
      if (isSkipped(key)) continue;
      if (pendingStrategyIds.has(cfg.id)) continue;

      out.push({
        key,
        strategyId: cfg.id,
        ticker: cfg.ticker,
        direction,
        profile: cfg.profile,
        strategyName: cfg.strategy_name || cfg.ticker,
        confirmEntry: cfg.confirm_entry,
        confirmDeadline: row.confirm_deadline ?? null,
        orbHigh: row.orb_high,
        orbLow: row.orb_low,
        currentPrice: row.current_price,
        tradeDate,
      });
    }
    return out;
  }, [liveConfigs, monitoringByTicker, pendingStrategyIds, isSkipped, tradeDate]);

  // Live underlying price for whichever tickers actually have a candidate
  // showing right now — overrides the (slower-moving) monitoring-state
  // current_price once the stream has ticked at least once.
  const tickers = useMemo(
    () => Array.from(new Set(rawCandidates.map(c => c.ticker))),
    [rawCandidates],
  );
  const { livePrices } = useMarketStream(tickers, { enabled: tickers.length > 0 });

  const candidates = useMemo(
    () => rawCandidates.map(c => ({
      ...c,
      currentPrice: livePrices[c.ticker] ?? c.currentPrice,
    })),
    [rawCandidates, livePrices],
  );

  return {
    candidates,
    isLoading: configsLoading || monitoringLoading,
    handleSkip: (c: CandidateBreakout) => skip(c.key),
  };
}
