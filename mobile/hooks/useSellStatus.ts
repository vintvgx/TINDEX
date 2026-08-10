import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const QUERY_KEY = ['sell-status'];
const SOLD_DISPLAY_MS = 20_000;
// Safety net, independent of whether the sell mutation ever settles — see
// useSellPosition's 2026-08-09 fix for the specific bug this backstops (a
// hung fetch with no timeout left a "Selling…" status, and the ticker tape
// it hijacks, stuck forever). This is deliberately generous — the backend's
// own worst case is ~10s and the mutation now times out at 30s — so this
// should only ever fire if something clears the mutation's own timeout too
// (e.g. a backgrounded app pausing JS timers). Belt-and-suspenders: the tape
// must always be able to recover on its own, no matter what fails upstream.
const SELLING_SAFETY_NET_MS = 45_000;

export interface SellStatus {
  id: string;
  phase: 'selling' | 'sold';
  /** Engine id — used to open a live-price WS while `phase === 'selling'`. */
  strategyId: string;
  ticker: string;
  /** e.g. "IWM 300C" — no expiry, matches how the ticker tape names things. */
  contractLabel: string;
  qty: number;
  /** Fill price once sold; unset while selling (tape shows the live streamed price instead). */
  price?: number;
}

type SellStatusMap = Record<string, SellStatus>;

/**
 * Client-only, ephemeral "a manual sell is in flight / just filled" signal —
 * same React Query-cache-as-store trick as useSkippedCandidates, so
 * TickerTape (mounted once at the tab-navigator root, see _layout.tsx) can
 * react to a sell fired from ExitTradeModal without a new Context provider.
 * Never touches AsyncStorage — this is meant to vanish on its own, not
 * survive a reload.
 *
 * ExitTradeModal closes itself the instant the sell is submitted (see its
 * own docstring) instead of blocking on the mutation, so this is the only
 * place the user sees the sell actually resolve.
 */
export function useSellStatus() {
  const qc = useQueryClient();
  const { data: statusMap = {} } = useQuery<SellStatusMap>({
    queryKey: QUERY_KEY,
    queryFn: () => ({}),
    staleTime: Infinity,
  });

  const startSelling = useCallback((s: Omit<SellStatus, 'phase' | 'price'>) => {
    const current = qc.getQueryData<SellStatusMap>(QUERY_KEY) ?? {};
    qc.setQueryData(QUERY_KEY, { ...current, [s.id]: { ...s, phase: 'selling' as const } });

    // Only clears if STILL 'selling' when this fires — a normal, timely
    // success/failure already transitioned or removed this entry long
    // before 45s, so this is a no-op on the happy path. It only acts when
    // neither markSold nor clearSelling ever got called at all.
    setTimeout(() => {
      const latest = qc.getQueryData<SellStatusMap>(QUERY_KEY) ?? {};
      if (latest[s.id]?.phase !== 'selling') return;
      const { [s.id]: _drop, ...rest } = latest;
      qc.setQueryData(QUERY_KEY, rest);
    }, SELLING_SAFETY_NET_MS);
  }, [qc]);

  // Sold status sticks around for SOLD_DISPLAY_MS then removes itself — the
  // tape reverts to its normal content with no further action needed.
  const markSold = useCallback((id: string, price: number, qty: number) => {
    const current = qc.getQueryData<SellStatusMap>(QUERY_KEY) ?? {};
    if (!current[id]) return;
    qc.setQueryData(QUERY_KEY, { ...current, [id]: { ...current[id], phase: 'sold' as const, price, qty } });
    setTimeout(() => {
      const latest = qc.getQueryData<SellStatusMap>(QUERY_KEY) ?? {};
      if (!latest[id]) return;
      const { [id]: _drop, ...rest } = latest;
      qc.setQueryData(QUERY_KEY, rest);
    }, SOLD_DISPLAY_MS);
  }, [qc]);

  // Sell failed — drop it immediately rather than leaving a stale "Selling…"
  // line up; the failure toast (already shown by the caller) covers it.
  const clearSelling = useCallback((id: string) => {
    const current = qc.getQueryData<SellStatusMap>(QUERY_KEY) ?? {};
    if (!current[id]) return;
    const { [id]: _drop, ...rest } = current;
    qc.setQueryData(QUERY_KEY, rest);
  }, [qc]);

  return { statuses: Object.values(statusMap), startSelling, markSold, clearSelling };
}
