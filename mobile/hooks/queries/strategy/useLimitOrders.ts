import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { LimitOrdersResponse, WorkingLimitOrder } from '@/common/types/strategy';
import {
  isSimId, simCancelLimitOrder, simPlaceLimitOrders, useSimLimitOrders,
} from '@/lib/devSim/simPositions';

/**
 * Limit sell ladder (limit-sell-ladder spec): resting DAY limit sells on an
 * open position. Every hook routes a dev simulated position (`sim-…` id) to
 * the in-app simulator instead of the backend.
 *
 *   GET    /strategy/positions/<id>/limit-orders
 *   POST   /strategy/positions/<id>/limit-orders   {orders: [{qty, limit_price}]}
 *   DELETE /strategy/positions/<id>/limit-orders/<order_id>
 */

export const limitOrdersKey = (strategyId: string) => ['limit-orders', strategyId] as const;

export const isWorking = (o: WorkingLimitOrder) => o.status === 'working' || o.status === 'partially_filled';

function invalidatePosition(qc: QueryClient, strategyId: string) {
  qc.invalidateQueries({ queryKey: limitOrdersKey(strategyId) });
  qc.invalidateQueries({ queryKey: ['strategy-positions'] });
  qc.invalidateQueries({ queryKey: ['immediate-positions'] });
  qc.invalidateQueries({ queryKey: ['strategy-trades'] });
  qc.invalidateQueries({ queryKey: ['alpaca-both-accounts'] });
}

/** A position's ladder + held/working/available counts. Polls every ~5s only
 *  while an order is still working (fills also arrive via /ws/app pushes). */
export function useWorkingLimitOrders(strategyId: string | undefined, enabled = true) {
  const sim = isSimId(strategyId);
  const simData = useSimLimitOrders(strategyId);
  const query = useQuery<LimitOrdersResponse>({
    queryKey: limitOrdersKey(strategyId ?? ''),
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/limit-orders`);
      if (!res.ok) throw new Error(`Failed to load limit orders (${res.status})`);
      return res.json();
    },
    enabled: enabled && !!strategyId && !sim,
    staleTime: 2_000,
    refetchInterval: (q) => (q.state.data?.orders?.some(isWorking) ? 5_000 : false),
  });
  if (sim) return { data: simData ?? undefined, isLoading: false, error: null as Error | null };
  return { data: query.data, isLoading: query.isLoading, error: query.error as Error | null };
}

export interface PlaceLimitOrdersResult {
  status: 'accepted' | 'error';
  orders: WorkingLimitOrder[];
  errors: { qty: number; limit_price: number; error: string }[];
  message?: string;
}

export function usePlaceLimitOrders() {
  const qc = useQueryClient();
  return useMutation<PlaceLimitOrdersResult, Error, { strategyId: string; orders: { qty: number; limit_price: number }[] }>({
    mutationFn: async ({ strategyId, orders }) => {
      if (isSimId(strategyId)) return simPlaceLimitOrders(strategyId, orders);
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/limit-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      const json = (await res.json().catch(() => ({}))) as PlaceLimitOrdersResult;
      if (!res.ok || json.status !== 'accepted') throw new Error(json.message || `Request failed (${res.status})`);
      return json;
    },
    onSettled: (_d, _e, { strategyId }) => invalidatePosition(qc, strategyId),
  });
}

export function useCancelLimitOrder() {
  const qc = useQueryClient();
  return useMutation<{ status: string; order?: WorkingLimitOrder; message?: string }, Error, { strategyId: string; orderId: string }>({
    mutationFn: async ({ strategyId, orderId }) => {
      if (isSimId(strategyId)) return simCancelLimitOrder(strategyId, orderId);
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/limit-orders/${orderId}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.status !== 'ok') throw new Error(json.message || `Request failed (${res.status})`);
      return json;
    },
    onSettled: (_d, _e, { strategyId }) => invalidatePosition(qc, strategyId),
  });
}
