import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/**
 * Generate Thesis (handoff spec 6). The app only QUEUES a request — Bandit
 * writes the thesis on its own schedule and the backend pushes "Your NVDA
 * thesis is ready". While a request is pending this polls; nothing here (or
 * anywhere in the app) calls a model or holds a prompt.
 */

export interface Thesis {
  verdict: string;
  summary: string;
  conviction?: number;
  horizon?: string;
  for_you?: string[];
  bull?: string[];
  bear?: string[];
  what_changes?: string;
}

export interface ThesisState {
  ticker: string;
  status: 'none' | 'pending' | 'complete' | 'failed';
  thesis?: Thesis;
  generated_at?: string;
  price_at_generation?: number | null;
  next_earnings_at_generation?: string | null;
  request?: { id: string; status: string; created_at: string; error?: string | null } | null;
}

const key = (ticker: string, userId?: string) => ['ticker-thesis', ticker, userId];

export function useThesis(ticker: string, userId: string | undefined, enabled = true) {
  return useQuery<ThesisState>({
    queryKey: key(ticker, userId),
    enabled: !!userId && enabled,
    queryFn: async () => {
      const res = await fetch(
        `${RAILWAY_BASE_URL}/api/agent/thesis/${encodeURIComponent(ticker)}?user_id=${encodeURIComponent(userId!)}`,
      );
      if (!res.ok) throw new Error('Failed to load thesis');
      return res.json();
    },
    staleTime: 30_000,
    // Bandit usually answers within minutes; the push is the fast path.
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 15_000 : false),
  });
}

export function useRequestThesis(ticker: string, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/api/agent/thesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, user_id: userId }),
      });
      if (res.status !== 202) throw new Error('Could not queue the thesis');
      return res.json() as Promise<{ status: 'queued'; request_id: string }>;
    },
    onSuccess: (r) => {
      qc.setQueryData<ThesisState>(key(ticker, userId), (prev) => ({
        ...(prev ?? { ticker }),
        status: 'pending',
        request: { id: r.request_id, status: 'pending', created_at: new Date().toISOString() },
      }));
    },
  });
}

/** "Your thesis may be stale": earnings since it was written, or a 15%+ move. */
export function thesisStaleReason(t: ThesisState | undefined, price: number | null | undefined): string | null {
  if (!t || t.status === 'none' || !t.thesis) return null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (t.next_earnings_at_generation && t.next_earnings_at_generation <= today) {
    return 'Earnings have reported since this was written';
  }
  const base = t.price_at_generation;
  if (base && price && Math.abs(price - base) / base >= 0.15) {
    const pct = ((price - base) / base) * 100;
    return `${pct >= 0 ? 'Up' : 'Down'} ${Math.abs(pct).toFixed(0)}% since this was written`;
  }
  return null;
}
