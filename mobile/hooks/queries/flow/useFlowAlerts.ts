import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { FlowAlert } from '@/common/types/flow';

interface FlowAlertsResponse {
  success: boolean;
  data: FlowAlert[];
  available: boolean;
  error?: string;
}

export function useFlowAlerts(limit = 50) {
  return useQuery<FlowAlertsResponse>({
    queryKey: ['flow-alerts', limit],
    queryFn: async () => {
      const url = `${RAILWAY_BASE_URL}/flow-alerts?limit=${limit}`;
      const resp = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      if (!resp.ok) throw new Error(`Failed to fetch flow alerts: ${resp.statusText}`);
      const data: FlowAlertsResponse = await resp.json();
      if (!data.success) throw new Error(data.error ?? 'Failed to fetch flow alerts');
      return data;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
