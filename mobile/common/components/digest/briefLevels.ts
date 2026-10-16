import { useMemo } from 'react';
import { useLatestBrief } from '@/hooks/queries/digest/useMarketDigest';
import { useMorningBrief } from '@/hooks/queries/brief/useMorningBrief';
import { useKeyLevels } from '@/hooks/queries/priceLevels/useKeyLevels';
import { useCreateKeyLevel } from '@/hooks/mutations/priceLevels/useCreateKeyLevel';
import { useCancelKeyLevel } from '@/hooks/mutations/priceLevels/useCancelKeyLevel';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { isMuseBriefContent, type MuseBriefTicker } from '@/common/types/marketDigest';
import { setupLevels } from './SetupChart';

/**
 * A Morning Brief ticker's trigger / stop / target — shared by the Pick
 * Detail Sheet and the Charts tab so both read (and alert on) the same
 * levels.
 */
export interface BriefLevels {
  ticker: string;
  direction: 'CALL' | 'PUT';
  long: boolean;
  setup: string;
  trigger: number | null;
  /** The stop — the play's invalidation level. */
  stop: number | null;
  target: number | null;
  zone: { low: number; high: number } | null;
}

/** Notes prefix on a trigger alert armed from a brief pick. The backend
 *  (key_level_watcher.BRIEF_ALERT_NOTE) pushes these as a brief trigger cross. */
export const BRIEF_ALERT_NOTE = 'Brief pick';

/** A Morning Brief pick's levels (same reads as the Pick Detail Sheet). */
export function briefLevelsFor(pick: MuseBriefTicker): BriefLevels {
  const { long, trigger, invalidation, target, zone } = setupLevels(pick);
  return { ticker: pick.ticker, direction: pick.direction, long, setup: pick.setup, trigger, stop: invalidation, target, zone };
}

/**
 * The brief levels for `ticker`: its pick in the latest Morning Brief (the
 * Home card's watchlist + Muse picks), else today's TINDEX brief play.
 */
export function useBriefLevels(ticker: string | null | undefined): BriefLevels | null {
  const { digest } = useLatestBrief();
  const { data: engineBrief } = useMorningBrief();
  return useMemo(() => {
    if (!ticker) return null;
    const t = ticker.toUpperCase();
    const content = digest?.content_json;
    if (isMuseBriefContent(content)) {
      const pick = [...(content.watchlist ?? []), ...(content.muse_picks ?? [])].find((p) => p.ticker === t);
      if (pick) return briefLevelsFor(pick);
    }
    const play = engineBrief?.plays.find((p) => p.ticker === t);
    if (!play) return null;
    return {
      ticker: t,
      direction: play.direction,
      long: play.direction === 'CALL',
      setup: 'Brief play',
      trigger: play.trigger,
      stop: play.invalidation,
      target: play.target,
      zone: play.target_zone ? { low: play.target_zone.low, high: play.target_zone.high } : null,
    };
  }, [ticker, digest, engineBrief]);
}

/** Every ticker in the Morning Brief (latest brief's watchlist + Muse picks)
 *  or today's TINDEX brief plays — the same set useBriefLevels draws for. */
export function useBriefTickers(): Set<string> {
  const { digest } = useLatestBrief();
  const { data: engineBrief } = useMorningBrief();
  return useMemo(() => {
    const out = new Set<string>();
    const content = digest?.content_json;
    if (isMuseBriefContent(content)) {
      for (const p of [...(content.watchlist ?? []), ...(content.muse_picks ?? [])]) out.add(p.ticker.toUpperCase());
    }
    for (const p of engineBrief?.plays ?? []) out.add(p.ticker.toUpperCase());
    return out;
  }, [digest, engineBrief]);
}

/**
 * The trigger alert for a brief ticker: a watched key level at the trigger
 * (KeyLevelWatcher pushes on the first 1-min close through it, with that
 * bar's volume — no volume gate). Off until armed; `armed` reads the
 * existing level, so the sheet and the chart show the same state.
 */
export function useBriefTriggerAlert(levels: BriefLevels | null) {
  const { authState: { user } } = useAuth();
  const { data: keyLevels } = useKeyLevels();
  const { mutate: createLevel, isPending: creating } = useCreateKeyLevel();
  const { mutate: cancelLevel, isPending: cancelling } = useCancelKeyLevel();

  const existing = useMemo(() => {
    if (!levels || levels.trigger == null) return null;
    const trigger = levels.trigger;
    return (keyLevels ?? []).find((l) =>
      l.status === 'watching'
      && l.ticker.toUpperCase() === levels.ticker
      && (l.notes ?? '').startsWith(BRIEF_ALERT_NOTE)
      && Math.abs(Number(l.level_low) - trigger) < 0.005,
    ) ?? null;
  }, [keyLevels, levels]);

  const setArmed = (on: boolean, cb?: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
    if (!user?.id || !levels || levels.trigger == null) return;
    if (on) {
      if (existing) return;
      createLevel(
        {
          userId: user.id,
          ticker: levels.ticker,
          direction: levels.long ? 'bullish' : 'bearish',
          levelLow: levels.trigger,
          zoneType: 'trade',
          notes: `${BRIEF_ALERT_NOTE} — ${levels.setup} ${levels.direction} trigger${levels.target != null ? `, target ${levels.target.toFixed(2)}` : ''}`,
        },
        cb,
      );
    } else if (existing) {
      cancelLevel(existing.id, cb);
    }
  };

  return { armed: existing != null, busy: creating || cancelling, setArmed, alertLevelId: existing?.id ?? null };
}
