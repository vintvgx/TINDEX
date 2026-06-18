import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface EngineSessionState {
  ticker: string;
  profile: string;
  session_pnl: number;
  session_halted: boolean;
  daily_loss_limit: number;
  re_entry_cooldown_min: number;
  last_loss_by_direction: Record<string, { time: string; pnl: number }>;
}

/** Returns session risk state for all running engines, keyed by strategy_id. */
export function useStrategySessionState() {
  return useQuery<Record<string, EngineSessionState>>({
    queryKey: ['strategy-session-state'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/debug`);
      if (!res.ok) return {};
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
  });
}

/** Returns true if any engine has hit its daily loss limit. */
export function useAnyEngineHalted(): boolean {
  const { data } = useStrategySessionState();
  if (!data) return false;
  return Object.values(data).some(e => e.session_halted);
}
