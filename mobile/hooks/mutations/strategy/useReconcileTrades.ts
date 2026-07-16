import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';

interface ReconcileResult {
  contract_symbol: string;
  status: 'reconciled' | 'still_open' | 'already_closed' | 'verified_closed' | 'mismatch' | 'error';
  exit_reason?: string;
  exit_premium?: number | null;
  detail?: string;
  error?: string;
}

interface ReconcileTradesResponse {
  success: boolean;
  checked_open: number;
  checked_closed_today: number;
  reconciled: ReconcileResult[];
  still_open: ReconcileResult[];
  /** Marked closed in orb_trades today, but the broker still shows it open — needs manual review, never auto-fixed. */
  mismatches: ReconcileResult[];
  errors: ReconcileResult[];
}

/**
 * Cross-references orb_trades against Alpaca's real position state.
 * Fills in exit data for a position closed directly on Alpaca (bypassing
 * this app), which otherwise never gets recorded — and separately spot-
 * checks every OTHER trade from today (already marked closed) to confirm
 * the broker agrees, flagging (not auto-fixing) any mismatch.
 * Triggered by pull-to-refresh on the Trade Log screen.
 */
export function useReconcileTrades() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ReconcileTradesResponse> => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/strategy/trades/reconcile`, { method: 'POST' }, 20_000);
      const data: ReconcileTradesResponse = await res.json().catch(() => ({
        success: false, checked_open: 0, checked_closed_today: 0,
        reconciled: [], still_open: [], mismatches: [], errors: [],
      }));
      if (!res.ok || !data.success) {
        throw new Error(`Reconcile failed (${res.status})`);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
    },
  });
}
