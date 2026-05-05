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
