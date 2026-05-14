import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'chart_ema_periods';
const DEFAULT_PERIODS = [20, 50];

export function useEMASettings() {
  const [selectedPeriods, setSelectedPeriods] = useState<number[]>(DEFAULT_PERIODS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSelectedPeriods(parsed);
          }
        } catch {}
      }
      setIsLoaded(true);
    });
  }, []);

  const togglePeriod = useCallback((period: number) => {
    setSelectedPeriods(prev => {
      const next = prev.includes(period)
        ? prev.filter(p => p !== period)
        : [...prev, period].sort((a, b) => a - b);
      // Keep at least one EMA selected
      const saved = next.length > 0 ? next : prev;
      SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(saved));
      return saved;
    });
  }, []);

  return { selectedPeriods, togglePeriod, isLoaded };
}
