import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { ZeroDTEProfileName } from '@/common/types/zero_dte';

export function useEnterZeroDTEPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      ticker: string;
      contract_type: 'call' | 'put';
      strike: number;
      expiry: string;
      qty: number;
      entry_price: number;
      strategy_profile: ZeroDTEProfileName;
      mode: 'paper' | 'live';
      watchlist_ref_id?: string;
    }) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/zero-dte/positions/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to enter position');
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zero-dte-positions'] }),
  });
}

export function useExitZeroDTEPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      position_id: string;
      qty?: number;
      exit_price?: number;
      reason?: string;
    }) => {
      const { position_id, ...body } = payload;
      const resp = await fetch(`${RAILWAY_BASE_URL}/zero-dte/positions/${position_id}/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to exit position');
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zero-dte-positions'] }),
  });
}
