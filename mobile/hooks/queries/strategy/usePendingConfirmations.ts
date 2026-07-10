import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { PendingConfirmation } from '@/common/types/strategy';

export function usePendingConfirmations() {
  return useQuery<PendingConfirmation[]>({
    queryKey: ['pending-confirmations'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/pending-confirmations`);
      if (!res.ok) throw new Error('Failed to fetch pending confirmations');
      return res.json();
    },
    staleTime: 3_000,
    refetchInterval: 5_000,
    retry: 2,
  });
}
