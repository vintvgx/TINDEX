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

export interface ConfirmBriefPlayArgs {
  ticker: string;
  /** One of the play's contract_candidates; omit to auto-pick at entry. */
  contractSymbol?: string | null;
  /** false = enter on the LIVE account. Default paper. */
  paperMode?: boolean;
}

/** Accepts a bare ticker (paper, auto-pick) or the confirm card's choices. */
export function useConfirmBriefPlay() {
  return usePlayMutation((arg: string | ConfirmBriefPlayArgs) => {
    const a = typeof arg === 'string' ? { ticker: arg } : arg;
    return briefRequest(`/brief/plays/${a.ticker}/confirm`, 'POST', {
      ...(a.contractSymbol ? { contract_symbol: a.contractSymbol } : {}),
      paper_mode: a.paperMode !== false,
    });
  });
}

export function useSkipBriefPlay() {
  return usePlayMutation((ticker: string) => briefRequest(`/brief/plays/${ticker}/skip`, 'POST'));
}
