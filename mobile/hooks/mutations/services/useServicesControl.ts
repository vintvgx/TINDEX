import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface ServicesControlOptions {
  /** Subset of service names to start/stop. Omit to affect all services. */
  services?: string[];
  /** Bypass market-hours check (testing only). */
  debug?: boolean;
  /** ORB data provider: "alpaca" | "tradier". Default "alpaca". */
  provider?: string;
}

export interface ServiceResult {
  success: boolean;
  message: string;
  was_running?: boolean;
}

export interface ServicesControlResponse {
  success: boolean;
  results: Record<string, ServiceResult>;
  errors: string[];
}

async function callServicesEndpoint(
  action: 'start' | 'stop',
  options: ServicesControlOptions = {},
): Promise<ServicesControlResponse> {
  const res = await fetch(`${RAILWAY_BASE_URL}/services/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  const data: ServicesControlResponse = await res.json().catch(() => ({
    success: false,
    results: {},
    errors: ['parse_error'],
  }));

  // 207 = partial failure — still throw so the caller's onError fires
  if (!res.ok || !data.success) {
    const failed = data.errors?.join(', ') || res.statusText;
    throw new Error(`Failed to ${action} services: ${failed}`);
  }

  return data;
}

/**
 * Start all registered backend services (or a named subset).
 * On success, invalidates the 'services-status' query so status indicators update.
 */
export function useStartServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options?: ServicesControlOptions) =>
      callServicesEndpoint('start', options),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['services-status'] }),
  });
}

/**
 * Stop all registered backend services (or a named subset).
 * On success, invalidates the 'services-status' query.
 */
export function useStopServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options?: ServicesControlOptions) =>
      callServicesEndpoint('stop', options),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['services-status'] }),
  });
}

export interface UnsubscribeSymbolResult {
  success: boolean;
  symbol: string;
  was_in_use: boolean;
  message?: string;
}

/**
 * Force-unsubscribe one symbol from the option quote stream — the Service
 * Status screen's per-row action. If the symbol is currently backing an
 * open position, this blinds that position's TP/SL monitoring until
 * something re-subscribes it (nothing does automatically) — the caller
 * confirms with the user first for any row flagged in_use.
 */
export function useUnsubscribeOptionStreamSymbol() {
  const queryClient = useQueryClient();
  return useMutation<UnsubscribeSymbolResult, Error, string>({
    mutationFn: async (symbol) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/services/option-stream/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const data = (await res.json().catch(() => ({ success: false }))) as UnsubscribeSymbolResult;
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Failed to unsubscribe ${symbol}`);
      }
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services-status'] }),
  });
}

export interface ClearUnusedSubscriptionsResult {
  success: boolean;
  cleared_count: number;
  cleared_symbols: string[];
  message?: string;
}

/**
 * Bulk-unsubscribe every option-stream symbol that isn't backing an open
 * position right now — the Service Status screen's "Clear Unused" button.
 * Subscriptions are additive on Alpaca's side with no automatic expiry, so
 * this is the manual remediation for a connection that's slowly accumulated
 * dead symbols across weeks of uptime.
 */
export function useClearUnusedOptionSubscriptions() {
  const queryClient = useQueryClient();
  return useMutation<ClearUnusedSubscriptionsResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/services/option-stream/clear-unused`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json().catch(() => ({ success: false }))) as ClearUnusedSubscriptionsResult;
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to clear unused subscriptions');
      }
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services-status'] }),
  });
}
