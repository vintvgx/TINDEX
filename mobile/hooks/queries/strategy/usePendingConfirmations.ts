import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { PendingConfirmation } from '@/common/types/strategy';
import { isMarketHours } from '@/lib/marketHours';
import { isAppSocketConnected } from '@/common/services/appSocket';

export function usePendingConfirmations() {
  return useQuery<PendingConfirmation[]>({
    queryKey: ['pending-confirmations'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/pending-confirmations`);
      if (!res.ok) throw new Error('Failed to fetch pending confirmations');
      return res.json();
    },
    staleTime: 3_000,
    // Confirmations only arise while the market's open — no polling nights
    // and weekends (audit A6). Still fetches once on mount/foreground. While
    // /ws/app is connected, new/expired confirmations are pushed (C2), so
    // the poll is just a 30s safety net.
    refetchInterval: () => (!isMarketHours() ? false : isAppSocketConnected() ? 30_000 : 5_000),
    retry: 2,
  });
}
