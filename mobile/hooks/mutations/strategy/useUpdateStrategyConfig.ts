import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyConfig, ProfileKey } from '@/common/types/strategy';

type ConfigPatch = Partial<StrategyConfig>;

export function useUpdateStrategyConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: ConfigPatch) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update config');
      const json = await res.json();
      return json.config as StrategyConfig;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['strategy-config'], updated);
    },
  });
}

export function useForceClosePosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/force-close`, { method: 'POST' });
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
