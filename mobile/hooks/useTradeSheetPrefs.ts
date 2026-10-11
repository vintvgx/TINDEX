import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StopType } from '@/common/components/strategy/StopTypeSelector';
import type { LadderSetup } from '@/common/components/trade/ExitLadder';

/**
 * The trade sheet's "Exit details" choices (stop type, worst-case floor,
 * breakeven grace, volume exit) plus the ladder setup, remembered across
 * opens (trade sheet v2, 2026-10-11). `loaded` is false until storage has
 * been read, so the sheet can wait before applying them.
 */

export interface TradeSheetPrefs {
  stopType: StopType;
  floorPct: number | null;
  beGrace: number;
  volumeExit: boolean;
  ladderSetup: LadderSetup;
}

const KEY = 'trade_sheet_prefs_v2';

export function useTradeSheetPrefs() {
  const [prefs, setPrefs] = useState<Partial<TradeSheetPrefs> | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (alive) setPrefs(raw ? (JSON.parse(raw) as Partial<TradeSheetPrefs>) : {});
      })
      .catch(() => {
        if (alive) setPrefs({});
      });
    return () => {
      alive = false;
    };
  }, []);

  const remember = useCallback((patch: Partial<TradeSheetPrefs>) => {
    setPrefs((prev) => {
      const next = { ...(prev ?? {}), ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { prefs: prefs ?? {}, loaded: prefs != null, remember };
}
