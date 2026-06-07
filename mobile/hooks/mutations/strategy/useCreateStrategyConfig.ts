import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyConfig } from '@/common/types/strategy';

type CreatePayload = Omit<StrategyConfig, 'id' | 'has_position'>;

export function useCreateStrategyConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreatePayload) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to create strategy');
      return res.json() as Promise<StrategyConfig>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
