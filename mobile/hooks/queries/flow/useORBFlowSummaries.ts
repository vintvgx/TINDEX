import { useQueries } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { FlowAlert } from '@/common/types/flow';
import type { FlowSummary } from '@/common/components/orb/ORBCard';

interface TickerFlowResponse {
  success: boolean;
  ticker: string;
  data: FlowAlert[];
  available: boolean;
}

function computeORBFlowSummary(alerts: FlowAlert[]): FlowSummary {
  const total = alerts.length;
  if (total === 0) return { callPct: 0, putPct: 0, totalAlerts: 0, topUnusualScore: 0 };

  const calls = alerts.filter(a => a.contract_type === 'call').length;
  const topScore = alerts.reduce((max, a) => Math.max(max, parseFloat(a.unusual_score) || 0), 0);

  return {
    callPct: Math.round((calls / total) * 100),
    putPct: Math.round(((total - calls) / total) * 100),
    totalAlerts: total,
    topUnusualScore: topScore,
  };
}

export function useORBFlowSummaries(tickers: string[]): Record<string, FlowSummary> {
  const results = useQueries({
    queries: tickers.map(ticker => ({
      queryKey: ['flow-alerts', ticker, 20],
      queryFn: async (): Promise<TickerFlowResponse> => {
        const url = `${RAILWAY_BASE_URL}/flow-alerts/${ticker.toUpperCase()}?limit=20`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Flow fetch failed for ${ticker}`);
        return resp.json();
      },
      staleTime: 60 * 1000,
      refetchInterval: 90 * 1000,
      retry: false,
      enabled: tickers.length > 0,
    })),
  });

  const summaries: Record<string, FlowSummary> = {};
  results.forEach((result, i) => {
    const ticker = tickers[i];
    if (result.data?.success && result.data.data?.length > 0) {
      summaries[ticker] = computeORBFlowSummary(result.data.data);
    }
  });
  return summaries;
}
