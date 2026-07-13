import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface OrbHubHealth {
  running: boolean;
  healthy: boolean;
  calculation_phase?: boolean;
  active_tickers?: string[];
  orb_ranges_count?: number;
  seconds_since_last_bar?: number | null;
  market_hours?: boolean;
}

/**
 * Polls GET /tindex/orb/status — the shared bar/breakout feed every strategy
 * depends on. `healthy` is computed server-side from real bar-arrival liveness,
 * not just the `running` flag: on 2026-07-09 the service reported itself as
 * running while the underlying stream had gone silent, and every strategy sat
 * blind through two clean, tradeable breakouts with nothing in the UI showing
 * it. This is what a banner off this hook is meant to catch.
 */
export function useOrbHubHealth() {
  return useQuery<OrbHubHealth>({
    queryKey: ['orb-hub-health'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/tindex/orb/status`);
      if (!res.ok) throw new Error('Failed to fetch ORB hub status');
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 2,
  });
}
