import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export function useDeleteStrategyConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (strategyId: string) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/configs/${strategyId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete strategy');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
