import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

interface UpdateStrategyExitsPayload {
  strategy_id: string;
  hard_stop?: number;
  tp1?: number;
  tp2?: number;
  /** "Advanced" per-level contract counts — how many of the remaining
   *  position to sell at that level, replacing the profile's fixed close
   *  percentage. sl_qty is a one-time partial: it leaves whatever's left
   *  running unprotected rather than re-firing on the same breach. */
  sl_qty?: number;
  tp1_qty?: number;
  tp2_qty?: number;
  /** Stop type — null switches to Hard Stop, 5/10/15 arms the matching
   *  grace-timer window (see exit_manager.py's sl_grace_* fields). */
  sl_grace_minutes?: number | null;
  /** How the runner is managed post-TP1 for the rest of THIS open trade —
   *  independent of the profile's default (see exit_manager.py's
   *  apply_overrides). */
  runner_mode?: 'trail' | 'be_hold' | 'none';
  /** On/off switch for cascade partial-sells for the rest of this trade.
   *  Never overrides the qty_remaining > 1 exemption — a 1-contract runner
   *  stays cascade-exempt regardless of this flag. */
  cascade_enabled?: boolean;
  /** Whether the hard stop-loss / TP1+TP2 exits are active for this trade —
   *  lets a runner run its course (or hold into close) mid-trade. Re-enabling
   *  either requires a real price in this same call (hard_stop/tp1 above)
   *  unless one's already set — see ExitManager.apply_overrides. */
  sl_enabled?: boolean;
  tp_enabled?: boolean;
}

export function useUpdateStrategyExits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ strategy_id, ...body }: UpdateStrategyExitsPayload) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/configs/${strategy_id}/exits`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json.status !== 'ok') throw new Error(json.message ?? `Request failed (${resp.status})`);
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategy-positions'] }),
  });
}
