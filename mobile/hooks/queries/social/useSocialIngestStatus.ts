import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';

export interface SocialIngestAccountStatus {
  id: string;
  handle: string;
  active: boolean;
  x_user_id: string | null;
  parse_keywords: string[];
  last_seen_tweet_id: string | null;
  last_polled_at: string | null;
  /** Set when the backend poll loop hit a problem for this account (e.g. an
   *  X handle that didn't resolve to a user id — often a typo). Only visible
   *  here: the mobile Log Viewer captures client-side console output only,
   *  not this backend poll loop. */
  last_poll_error: string | null;
}

export interface SocialIngestStatus {
  running: boolean;
  live_since?: string | null;
  toggle?: boolean;
  has_bearer_token?: boolean | null;
  /** ISO timestamp of the last poll cycle attempt, regardless of outcome. */
  last_poll_at?: string | null;
  /** Human-readable one-liner, e.g. "2 new tweet(s) across 1 account(s)". */
  last_poll_summary?: string | null;
  accounts?: SocialIngestAccountStatus[];
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
