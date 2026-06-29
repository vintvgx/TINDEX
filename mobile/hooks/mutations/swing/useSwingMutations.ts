import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { SwingProfileName } from '@/common/types/swing';

export function useRunSwingPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`Pipeline run failed: ${resp.statusText}`);
      return resp.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['swing-scores'] });
      qc.invalidateQueries({ queryKey: ['swing-run-logs'] });
    },
  });
}

export function useAddSwingWatchlist(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { contract_symbol: string; ticker: string; note?: string }) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/watchlist`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error('Failed to add to watchlist');
      return resp.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['swing-watchlist', userId] }),
  });
}

export function useRemoveSwingWatchlist(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (watchlistId: string) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/watchlist/${watchlistId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      if (!resp.ok) throw new Error('Failed to remove from watchlist');
      return resp.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['swing-watchlist', userId] }),
  });
}

export function useEnterSwingPosition(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      contract_symbol: string;
      ticker: string;
      qty: number;
      entry_price: number;
      mode: 'paper' | 'live';
      strategy_profile: SwingProfileName;
      side: 'call' | 'put';
    }) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/positions/enter`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error('Failed to enter position');
      return resp.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['swing-positions', userId] }),
  });
}

export function useExitSwingPosition(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      position_id: string;
      qty?: number;
      exit_price?: number;
    }) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/positions/${payload.position_id}/exit`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ qty: payload.qty, exit_price: payload.exit_price }),
      });
      if (!resp.ok) throw new Error('Failed to exit position');
      return resp.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['swing-positions', userId] }),
  });
}
