import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

/** Per-ticker confirm/auto entry preferences ({ticker: mode}), set from the
 *  Morning Brief digest cards or the Brief tab. Missing tickers default to
 *  'confirm' — the server seeds every 9:00 ET build that way too. */
export function useBriefEntryModes() {
  return useQuery<Record<string, 'confirm' | 'auto'>>({
    queryKey: ['brief-entry-modes'],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/brief/modes`, {
        headers: await getAuthHeaders(),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.success) throw new Error(json.error ?? `Failed to load entry modes (${resp.status})`);
      return json.data ?? {};
    },
    staleTime: 60_000,
  });
}
