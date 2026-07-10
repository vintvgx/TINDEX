import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { FlowAlert } from '@/common/types/flow';

interface TickerFlowResponse {
  success: boolean;
  ticker: string;
  data: FlowAlert[];
  available: boolean;
  error?: string;
}

export function useTickerFlowAlerts(ticker: string | null, limit = 50) {
  return useQuery<TickerFlowResponse>({
    queryKey: ['flow-alerts', ticker, limit],
    queryFn: async () => {
      const t = ticker!.trim().toUpperCase();
      const url = `${RAILWAY_BASE_URL}/flow-alerts/${t}?limit=${limit}`;
      const resp = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      if (!resp.ok) throw new Error(`Failed to fetch flow for ${t}: ${resp.statusText}`);
      const data: TickerFlowResponse = await resp.json();
      if (!data.success) throw new Error(data.error ?? `Failed to fetch flow for ${t}`);
      return data;
    },
    enabled: !!ticker && ticker.trim().length >= 1 && ticker.trim().length <= 5,
    staleTime: 5 * 60 * 1000,   // treat as fresh for 5 min — user pulls to refresh manually
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
