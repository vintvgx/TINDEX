import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const QUERY_KEY = ['sell-status'];
const SOLD_DISPLAY_MS = 20_000;

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
