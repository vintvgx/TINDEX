import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface ContractDelta {
  delta: number | null;
  bid: number | null;
  ask: number | null;
  /** Date.now() when fetched — the sheet shows its age. */
  fetchedAt: number;
}

/**
 * The open contract's own snapshot Greeks (spec 2026-11-10 §3.2) — the
 * single-contract snapshot, not the chain. Fetched by the exit sheet on open /
 * after a drag, and by the chart lines every 5 minutes and on any trade state
 * change (bump `nonce`). Delta is signed by the contract (CALL +, PUT −).
 * Null delta = conversion disabled, never a guess.
 *
 * Route: /swing/contract/<symbol>/quote — the same Alpaca
 * get_contract_snapshot call as the spec's GET /muse/contract (which needs
 * the Muse API key the app doesn't hold); only the route name differs.
 */
export function useContractDelta(symbol: string | null | undefined, nonce: number | string, enabled: boolean,
                                 refetchIntervalMs?: number) {
  return useQuery<ContractDelta>({
    queryKey: ['contract-delta', symbol, nonce],
    enabled: !!symbol && enabled && !symbol.startsWith('sim'),
    staleTime: 60_000,
    refetchInterval: enabled && refetchIntervalMs ? refetchIntervalMs : false,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/contract/${encodeURIComponent(symbol!)}/quote`);
      const json = await resp.json().catch(() => ({}));
      const d = json?.data ?? {};
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      return { delta: num(d.delta), bid: num(d.bid), ask: num(d.ask), fetchedAt: Date.now() };
    },
  });
}
