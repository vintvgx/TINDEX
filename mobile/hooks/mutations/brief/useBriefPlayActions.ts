import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { BriefPlay, BriefPlayMode, MorningBrief } from '@/common/types/morningBrief';

async function briefRequest(path: string, method: 'POST' | 'PATCH', body?: object): Promise<BriefPlay> {
  const resp = await fetch(`${RAILWAY_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.success) throw new Error(json.error ?? `Request failed (${resp.status})`);
  return json.data;
}

/** Writes the returned play into the cached brief so the card updates
 *  before the next poll, then refetches. */
function usePlayMutation<V>(fn: (v: V) => Promise<BriefPlay>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (play) => {
      qc.setQueryData<MorningBrief | null>(['morning-brief'], (b) =>
        b ? { ...b, plays: b.plays.map(p => (p.ticker === play.ticker ? { ...p, ...play } : p)) } : b);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['morning-brief'] }),
  });
}

export function useSetBriefPlayMode() {
  return usePlayMutation(({ ticker, mode }: { ticker: string; mode: BriefPlayMode }) =>
    briefRequest(`/brief/plays/${ticker}`, 'PATCH', { mode }));
}

export function useConfirmBriefPlay() {
  return usePlayMutation((ticker: string) => briefRequest(`/brief/plays/${ticker}/confirm`, 'POST'));
}

export function useSkipBriefPlay() {
  return usePlayMutation((ticker: string) => briefRequest(`/brief/plays/${ticker}/skip`, 'POST'));
}
