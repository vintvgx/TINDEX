import { useEffect, useRef, useState } from 'react';
import { useStrategyPositions } from '@/hooks/queries/strategy/useStrategyPosition';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';

const BOOTSTRAP_TIMEOUT_MS = 10_000;

/**
 * Gates the "Tindex is initializing" screen shown right after AuthContext
 * resolves — mirrors AuthContext's own isLoading gate, but for the app's
 * core position data instead of auth. On a cold start (closed/force-quit
 * relaunch) Dashboard/Live Positions/Strategy would otherwise each render
 * empty and independently spin up their own fetch; this waits for that
 * first load to land before the app navigates in.
 *
 * Caps the wait at BOOTSTRAP_TIMEOUT_MS so a slow or unreachable backend
 * never stalls the user on a splash screen — after the timeout `ready`
 * flips true regardless of fetch state and the screens fall back to their
 * own inline loading indicators, same as they do on a normal poll refetch.
 */
export function useAppBootstrap(enabled: boolean) {
  const { isLoading: stratLoading } = useStrategyPositions(enabled);
  const { isLoading: immLoading } = useImmediatePositions(enabled);
  const [timedOut, setTimedOut] = useState(false);
  const timerStarted = useRef(false);

  const dataLoading = enabled && (stratLoading || immLoading);

  useEffect(() => {
    if (!enabled) {
      // Sign-out mid-session (not a fresh cold start, which would remount
      // this hook anyway) — reset so a subsequent sign-in gets its own
      // fresh 10s window instead of inheriting an already-fired timer.
      timerStarted.current = false;
      setTimedOut(false);
      return;
    }
    if (timerStarted.current) return;
    timerStarted.current = true;
    const timer = setTimeout(() => setTimedOut(true), BOOTSTRAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [enabled]);

  return { ready: !enabled || !dataLoading || timedOut };
}
