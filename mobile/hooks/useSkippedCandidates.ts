import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'skipped_candidates_v1';
const QUERY_KEY = ['skipped-candidates'];

type SkippedSet = Record<string, true>;

export function candidateKey(
  strategyId: string, ticker: string, direction: 'CALL' | 'PUT', tradeDate: string,
): string {
  return `${strategyId}:${ticker}:${direction}:${tradeDate}`;
}

async function loadSkippedSet(): Promise<SkippedSet> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Client-only "don't show me this candidate breakout again today" — same
 * shape as useHiddenPositions, keyed by strategy+ticker+direction+trade_date
 * instead of a trade id, since a skipped candidate never had a backend
 * record to begin with (see candidate-breakout-card design: skip happens
 * entirely client-side, before any pending-confirmation row exists). Never
 * calls the backend. Naturally self-expires: a new trade_date key means
 * yesterday's skips just stop matching, no cleanup pass needed.
 */
export function useSkippedCandidates() {
  const qc = useQueryClient();
  const { data: skipped = {} } = useQuery<SkippedSet>({
    queryKey: QUERY_KEY,
    queryFn: loadSkippedSet,
    staleTime: Infinity,
  });

  const skip = useCallback(async (key: string) => {
    const current = qc.getQueryData<SkippedSet>(QUERY_KEY) ?? {};
    const next = { ...current, [key]: true as const };
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the skip for the rest of this session even if the write fails.
    }
  }, [qc]);

  const isSkipped = useCallback((key: string) => !!skipped[key], [skipped]);

  return { isSkipped, skip };
}
