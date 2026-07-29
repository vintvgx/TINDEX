import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'search_bar_hidden_v1';
const QUERY_KEY = ['search-bar-hidden'];

async function loadHidden(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

/**
 * Whether the floating search bar above the bottom tab nav (CustomTabBar) is
 * hidden — a Profile setting. Persisted to AsyncStorage and mirrored into the
 * React Query cache (same pattern as useHiddenPositions) so CustomTabBar
 * re-renders the instant the Profile toggle flips it, with no prop drilling.
 */
export function useSearchBarVisibility() {
  const qc = useQueryClient();
  const { data: hidden = false } = useQuery<boolean>({
    queryKey: QUERY_KEY,
    queryFn: loadHidden,
    staleTime: Infinity,
  });

  const setHidden = useCallback(async (next: boolean) => {
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the toggle for the rest of this session even if the write fails.
    }
  }, [qc]);

  return { hidden, setHidden };
}
