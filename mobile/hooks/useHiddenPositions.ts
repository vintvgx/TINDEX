import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'hidden_positions_v1';
const QUERY_KEY = ['hidden-positions'];

type HiddenSet = Record<string, true>;

async function loadHiddenSet(): Promise<HiddenSet> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Purely client-side "hide this trade from the Dashboard/Live Positions
 * list" — this never calls the backend. Persisted to AsyncStorage (so it
 * survives an app restart) and mirrored into the React Query cache under a
 * shared key so every screen using this hook re-renders the instant one of
 * them hides/unhides something, without any prop drilling between them.
 * Stays hidden until explicitly un-hidden from the same Edit menu — nothing
 * else ever clears an entry.
 */
export function useHiddenPositions() {
  const qc = useQueryClient();
  const { data: hidden = {} } = useQuery<HiddenSet>({
    queryKey: QUERY_KEY,
    queryFn: loadHiddenSet,
    staleTime: Infinity,
  });

  const setHidden = useCallback(async (key: string, isHidden: boolean) => {
    const current = qc.getQueryData<HiddenSet>(QUERY_KEY) ?? {};
    const next = { ...current };
    if (isHidden) {
      next[key] = true;
    } else {
      delete next[key];
    }
    qc.setQueryData(QUERY_KEY, next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort persistence — the query cache above already reflects
      // the toggle for the rest of this session even if the write fails.
    }
  }, [qc]);

  const isHidden = useCallback((key: string) => !!hidden[key], [hidden]);

  return { isHidden, setHidden };
}
