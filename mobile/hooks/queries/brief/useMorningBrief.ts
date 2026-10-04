import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { MorningBrief } from '@/common/types/morningBrief';

const LIVE_STATUSES = new Set(['checking', 'awaiting_confirmation', 'working']);

/** Minutes since midnight, New York time. */
function etMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/**
 * Today's brief. Poll rate follows what's happening: 2s while a play is
 * mid-trigger (checking / awaiting confirmation / limit order working),
 * 15s through the 8:55–10:05 brief window, otherwise 5 min.
 */
export function useMorningBrief() {
  return useQuery<MorningBrief | null>({
    queryKey: ['morning-brief'],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/brief/today`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.success) throw new Error(json.error ?? `Failed to load brief (${resp.status})`);
      return json.data ?? null;
    },
    refetchInterval: (query) => {
      const brief = query.state.data;
      if (brief?.plays.some(p => LIVE_STATUSES.has(p.status))) return 2000;
      const m = etMinutes();
      if (m >= 8 * 60 + 55 && m <= 10 * 60 + 5) return 15000;
      return 5 * 60 * 1000;
    },
    staleTime: 1000,
    retry: 1,
  });
}
