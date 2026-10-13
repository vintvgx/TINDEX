import type { QueryClient } from '@tanstack/react-query';
import { isMarketHours } from '@/lib/marketHours';
import { isAppSocketConnected } from '@/common/services/appSocket';

/**
 * Poll cadence for the position REST endpoints (polling audit A6).
 *
 * These used to poll every 5s around the clock. Live prices come from the
 * per-position WebSocket (equity included — see useLiveEquity); the polls
 * only need to catch structure changes (a fill, a close). So:
 *
 *   market closed / weekend     → no polling (one fetch on mount/focus)
 *   just traded (boost window)  → 5s, so a fill or close shows up fast
 *   positions open (`fast`)     → 5s
 *   otherwise                   → 30s, or 60s while /ws/app is connected
 *                                 (fills/closes are pushed — C2; the poll
 *                                 is only a safety net then)
 */
const FAST_MS = 5_000;
const SLOW_MS = 30_000;
const SAFETY_NET_MS = 60_000;
const BOOST_MS = 120_000;

let boostUntil = 0;

export function positionPollMs(opts: { fast?: boolean } = {}): number | false {
  if (!isMarketHours()) return false;
  if (Date.now() < boostUntil) return FAST_MS;
  if (opts.fast) return FAST_MS;
  return isAppSocketConnected() ? SAFETY_NET_MS : SLOW_MS;
}

/** Call after an entry, confirm, approve or sell: polls at 5s for the next
 *  2 minutes and refetches the position queries right away, so the new or
 *  closed position appears without waiting out a 30s interval. */
export function boostPositionPolling(queryClient: QueryClient): void {
  boostUntil = Date.now() + BOOST_MS;
  queryClient.invalidateQueries({ queryKey: ['immediate-positions'] });
  queryClient.invalidateQueries({ queryKey: ['alpaca-position-values'] });
}
