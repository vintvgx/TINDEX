import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'seen_market_digests_v1';
const QUERY_KEY = ['seen-market-digests'];

type SeenSet = Record<string, true>;

async function loadSeenSet(): Promise<SeenSet> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Purely client-side "has this day's Market Digest been opened" — drives
 * whether MarketDigestCard still shows on the Home feed header once the
 * user has already viewed that date's digest (see MarketDigestModal, which
 * calls markSeen the moment it opens for a date). Never cleared
 * automatically; a past date's entry just stops mattering once
 * useMarketDigest starts returning a new day's data.
 */
export function useSeenMarketDigests() {
  const qc = useQueryClient();
  const { data: seen = {} } = useQuery<SeenSet>({
    queryKey: QUERY_KEY,
    queryFn: loadSeenSet,
    staleTime: Infinity,
  });

  const markSeen = useCallback(async (date: string) => {
    const current = qc.getQueryData<SeenSet>(QUERY_KEY) ?? {};
    if (current[date]) return;
    const next = { ...current, [date]: true as const };
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // it for the rest of this session even if the write fails.
    }
  }, [qc]);

  const isSeen = useCallback((date: string) => !!seen[date], [seen]);

  return { isSeen, markSeen };
}
