import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { MarketDigestRow } from '@/common/types/marketDigest';

/** Recent digest dates only (no content_json) — for a calendar-style list,
 *  mirroring usePerformanceReviews' list/detail split. */
export function useMarketDigestList(limit = 30) {
  return useQuery<{ success: boolean; data: Array<{ digest_date: string; created_at: string }>; count: number }>({
    queryKey: ['market-digests', limit],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/market-digest/list?limit=${limit}`);
      if (!resp.ok) throw new Error(`Failed to fetch digests: ${resp.statusText}`);
      return resp.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

/** Shared by the hook below and by any one-off on-demand check (e.g. Daily
 *  Review's "View Market Digest" button, which needs to know — before
 *  opening MarketDigestModal — whether a digest exists at all for a picked
 *  past date, so it can alert instead of opening to an empty state). */
export async function fetchMarketDigest(date: string): Promise<{ success: boolean; data: MarketDigestRow }> {
  const resp = await fetch(`${RAILWAY_BASE_URL}/market-digest/${date}`);
  const json = await resp.json();
  if (!resp.ok || !json.success) throw new Error(json.error ?? 'Digest not found');
  return json;
}

export function useMarketDigest(date: string | null) {
  return useQuery<{ success: boolean; data: MarketDigestRow }>({
    queryKey: ['market-digest', date],
    queryFn: () => fetchMarketDigest(date!),
    enabled: !!date,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

function etTodayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** "MORNING BRIEF" today, "YESTERDAY'S BRIEF", else "BRIEF · OCT 10". */
export function briefLabel(date: string | null): string {
  if (!date) return 'MORNING BRIEF';
  const today = etTodayISO();
  if (date === today) return 'MORNING BRIEF';
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
  if (date === yesterday) return "YESTERDAY'S BRIEF";
  const [, mm, dd] = date.split('-').map(Number);
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][mm - 1];
  return `BRIEF · ${mon} ${dd}`;
}

/**
 * The most recent published brief — today's once it lands (8:00 AM ET),
 * otherwise the last one (yesterday's, Friday's over a weekend). Never an
 * empty "no brief yet" gap off-hours. `isToday` / `label` let the UI say
 * which day it's showing.
 */
export function useLatestBrief() {
  const list = useMarketDigestList(30);
  const date = list.data?.data?.[0]?.digest_date ?? null;
  const digest = useMarketDigest(date);
  return {
    digest: digest.data?.data ?? null,
    date,
    isToday: date === etTodayISO(),
    label: briefLabel(date),
    isLoading: list.isLoading || (!!date && digest.isLoading),
    isError: list.isError || digest.isError,
    refetch: () => { list.refetch(); if (date) digest.refetch(); },
  };
}
