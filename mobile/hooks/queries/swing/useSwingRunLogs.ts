import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { SwingRunLog } from '@/common/types/swing';

interface SwingRunLogsResponse {
  success: boolean;
  data: SwingRunLog[];
  error?: string;
}

export function useSwingRunLogs(limit = 20) {
  return useQuery<SwingRunLogsResponse>({
    queryKey: ['swing-run-logs', limit],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/run-logs?limit=${limit}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`Failed to fetch swing run logs: ${resp.statusText}`);
      const json: SwingRunLogsResponse = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch run logs');
      return json;
    },
    staleTime: 2 * 60 * 1000,
  });
}
