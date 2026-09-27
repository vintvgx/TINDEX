import { useMutation } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ProfileKey } from '@/common/types/strategy';
import type { TickerHistoryData } from '@/common/types/blogPosts/ticker';

export type SimScenario = 'profit' | 'loss' | 'reversal';

/** The only profiles a simulation can run — the automated ORB-breakout set. */
export type SimProfileKey =
  | 'BULL_DOG' | 'THUNDER_CAT' | 'WOLF' | 'TREND_RIDER' | 'RETESTER' | 'REVERSAL';

export interface SimulationResult {
  status:           string;
  scenario:         SimScenario;
  strategy_id:      string;
  duration_seconds: number;
  ticks:            number;
  ticker:           string;
  entry_premium:    number;
  profile:          string;
  orb_high:         number;
  orb_low:          number;
  history:          TickerHistoryData;
}

export function useRunSimulation() {
  return useMutation<
    SimulationResult,
    Error,
    { scenario: SimScenario; strategy_id?: string; profile?: SimProfileKey | ProfileKey; suppress_push?: boolean }
  >({
    mutationFn: async ({ scenario, strategy_id, profile, suppress_push }) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/simulate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scenario, strategy_id, profile, suppress_push }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        throw new Error(err.error || 'Failed to start simulation');
      }
      return res.json() as Promise<SimulationResult>;
    },
  });
}
