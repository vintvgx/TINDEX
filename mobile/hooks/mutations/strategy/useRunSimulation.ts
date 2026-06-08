import { useMutation } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export type SimScenario = 'profit' | 'loss' | 'reversal';

export interface SimulationResult {
  status:           string;
  scenario:         SimScenario;
  strategy_id:      string;
  duration_seconds: number;
  ticks:            number;
  ticker:           string;
  entry_premium:    number;
  profile:          string;
}

export function useRunSimulation() {
  return useMutation<
    SimulationResult,
    Error,
    { scenario: SimScenario; strategy_id?: string }
  >({
    mutationFn: async ({ scenario, strategy_id }) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/simulate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scenario, strategy_id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        throw new Error(err.error || 'Failed to start simulation');
      }
      return res.json() as Promise<SimulationResult>;
    },
  });
}
