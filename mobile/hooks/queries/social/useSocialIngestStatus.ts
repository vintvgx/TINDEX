import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';

export interface SocialIngestStatus {
  running: boolean;
  live_since?: string | null;
  toggle?: boolean;
  has_bearer_token?: boolean | null;
  accounts?: unknown[];
}

/**
 * Social signal ingest is deliberately not part of /services/status (see
 * api/routes/social_routes.py docstring — kept separate until it has a
 * track record), so the admin status screen polls it independently here.
 */
export function useSocialIngestStatus(options: { alwaysPoll?: boolean } = {}) {
  const { alwaysPoll = true } = options;
  return useQuery<SocialIngestStatus>({
    queryKey: ['social-ingest-status'],
    queryFn: async () => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/social-signals/status`);
      if (!res.ok) throw new Error(`Failed to fetch ingest status (${res.status})`);
      return res.json();
    },
    enabled: alwaysPoll,
    staleTime: 10_000,
    refetchInterval: alwaysPoll ? 15_000 : false,
    retry: 1,
  });
}
