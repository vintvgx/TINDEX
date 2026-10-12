import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface MarketNewsItem {
  headline: string;
  source: string;
  url: string;
  image?: string | null;
  published_at?: string | null;
}

const FIFTEEN_MIN = 15 * 60 * 1000;

/** Weekdays 6:00–20:00 ET — when the day's news is actually moving. */
function inNewsHours(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === 'weekday')?.value;
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  return wd !== 'Sat' && wd !== 'Sun' && h >= 6 && h < 20;
}

/**
 * The day's general market news (GET /market-news — Finnhub, server-cached
 * 15 min) for the Home card's headlines. Refreshes every 15 min through the
 * trading day; nights/weekends it fetches once on open and stops polling.
 */
export function useMarketNews() {
  return useQuery<MarketNewsItem[]>({
    queryKey: ['market-news'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/market-news`);
      if (!res.ok) throw new Error(`Failed to fetch news (${res.status})`);
      const json = await res.json();
      return (json.data ?? []) as MarketNewsItem[];
    },
    staleTime: FIFTEEN_MIN,
    refetchInterval: () => (inNewsHours() ? FIFTEEN_MIN : false),
    retry: 1,
  });
}
