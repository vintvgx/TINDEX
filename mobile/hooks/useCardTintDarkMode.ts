import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'card_tint_dark_mode_v1';
const QUERY_KEY = ['card-tint-dark-mode'];

async function loadEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

/**
 * Whether an open position card's green/red (call/put) accent tint also
 * applies to its background in dark mode — a Profile setting. Light mode
 * always tints (its card background otherwise matched the screen background
 * exactly and the card visually disappeared); dark mode defaults off since
 * colors.background already reads fine there, but some users want the same
 * tinted look. Persisted to AsyncStorage and mirrored into the React Query
 * cache (same pattern as useSearchBarVisibility) so LivePositionPanel
 * re-renders the instant the Profile toggle flips it.
 */
export function useCardTintDarkMode() {
  const qc = useQueryClient();
  const { data: enabled = false } = useQuery<boolean>({
    queryKey: QUERY_KEY,
    queryFn: loadEnabled,
    staleTime: Infinity,
  });

  const setEnabled = useCallback(async (next: boolean) => {
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the toggle for the rest of this session even if the write fails.
    }
  }, [qc]);

  return { enabled, setEnabled };
}
