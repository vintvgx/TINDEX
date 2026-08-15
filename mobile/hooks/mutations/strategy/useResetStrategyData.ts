import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface ResetOptions {
  clear_debug_logs?: boolean;
}

interface ResetResult {
  status: 'ok' | 'error';
  message: string;
  cleared: string[];
  engines_reset: number;
  /** "TICKER CONTRACT_SYMBOL" for each engine skipped because it currently
   *  holds an open position — see routes/strategy_routes.py's data/reset. */
  open_position_skips: string[];
}

export function useResetStrategyData() {
  const queryClient = useQueryClient();

  return useMutation<ResetResult, Error, ResetOptions>({
    mutationFn: async (opts = {}) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/data/reset`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(opts),
      });
      const json = (await res.json()) as ResetResult;
      if (!res.ok || json.status !== 'ok') {
        throw new Error(json.message || 'Reset failed');
      }
      return json;
    },
    onSuccess: () => {
      // Invalidate every query that shows trade/session/review data
      queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-stats'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-performance'] });
      queryClient.invalidateQueries({ queryKey: ['orb-session'] });
      queryClient.invalidateQueries({ queryKey: ['skipped-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['performance-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['performance-review'] });
      queryClient.invalidateQueries({ queryKey: ['pending-confirmations'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-session-state'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
