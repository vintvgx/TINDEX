import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { GateWatch } from '@/common/types/strategy';
import { isMarketHours } from '@/lib/marketHours';
import { isAppSocketConnected } from '@/common/services/appSocket';

/** Live blocked-breakout watches (backend gate_watch.py). Pushed via the
 *  /ws/app "pending" topic; the poll is a safety net, and also keeps the
 *  "time left" and re-check score fresh. An older API (no route) → []. */
export function useGateWatches() {
  return useQuery<GateWatch[]>({
    queryKey: ['gate-watches'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/gate-watches`);
      if (res.status === 404) return [];
      if (!res.ok) throw new Error('Failed to fetch gate watches');
      return res.json();
    },
    staleTime: 3_000,
    refetchInterval: () => (!isMarketHours() ? false : isAppSocketConnected() ? 60_000 : 15_000),
    retry: 1,
  });
}
