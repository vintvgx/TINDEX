import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyConfig } from '@/common/types/strategy';

type ConfigPatch = Partial<StrategyConfig> & { id: string };

export function useUpdateStrategyConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...patch }: ConfigPatch) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/configs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update config');
      const json = await res.json();
      return json.config as StrategyConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}

export function useForceClosePosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (strategyId?: string) => {
      const url = strategyId
        ? `${RAILWAY_BASE_URL}/strategy/configs/${strategyId}/force-close`
        : `${RAILWAY_BASE_URL}/strategy/force-close`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error('Force close failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-position'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
      queryClient.invalidateQueries({ queryKey: ['alpaca-account'] });
    },
  });
}
