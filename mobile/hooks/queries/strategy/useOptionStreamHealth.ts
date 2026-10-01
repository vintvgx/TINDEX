import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { isMarketHours } from '@/lib/marketHours';

export interface OptionStreamHealth {
  running: boolean;
  toggle: boolean;
  subscribed_count: number;
  subscribed_symbols: string[];
  expired_count: number;
  expired_symbols: string[];
  unused_count: number;
  subscriptions: { symbol: string; in_use: boolean; expired: boolean; last_quote_age_seconds: number | null; quote_count: number }[];
  last_quote_age_seconds: number | null;
  stale: boolean;
  /** How many straight verify_stream() timeouts since the last real quote
   *  or the last forced reconnect — 0 right after either. Hits
   *  RECONNECT_AFTER_CONSECUTIVE_FAILURES (3) the instant a reconnect
   *  fires, then resets to 0 in the same beat — so this is "how close to
   *  the next one," not a reliable way to catch the reconnect itself; use
   *  last_reconnect_at for that (see useOptionStreamReconnectEvent). */
  consecutive_verify_failures: number;
  /** ISO timestamp of the most recent forced reconnect this process has
   *  done, or null if none has ever fired. */
  last_reconnect_at: string | null;
  /** Lifetime count of forced reconnects this process has done. */
  reconnect_count: number;
  error?: string;
}

/**
 * Polls GET /option-stream/status — the real-time OPTION quote WebSocket's
 * health, separate from /tindex/orb/status (the STOCK-level bar feed
 * useOrbHubHealth watches). Backs the ticker tape's reconnect notification
 * (see useOptionStreamReconnectEvent) and is also just useful on its own —
 * `stale`/`consecutive_verify_failures` are what a Service Status-style
 * screen would show for this subsystem, same role orb/status plays for ORB.
 *
 * Gated to isMarketHours() (same shared check LivePositionPanel/
 * useOrbServiceAlert use, 9:15 AM–4:15 PM ET Mon–Fri) — `enabled: false`
 * stops BOTH the initial fetch and the 15s interval outright, not just the
 * interval. The host component (TickerTape) is mounted globally, the whole
 * time the app is open, so without this the poll would hit Railway all
 * night and every weekend for a subsystem (the live option-quote stream)
 * that's only ever relevant while the market's actually open — there's
 * nothing to verify a stream for outside trading hours, since nothing can
 * submit a 0DTE trade then either.
 */
export function useOptionStreamHealth() {
  return useQuery<OptionStreamHealth>({
    queryKey: ['option-stream-health'],
    enabled: isMarketHours(),
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/option-stream/status`);
      if (!res.ok) throw new Error('Failed to fetch option stream status');
      return res.json();
    },
    staleTime: 10_000,
    // `enabled: false` above already stops this outright outside market
    // hours (no initial fetch, no interval) — the 15s cadence below only
    // ever matters once enabled is true.
    refetchInterval: 15_000,
    retry: 2,
  });
}
