import { useEffect, useRef, useState } from 'react';
import { useOptionStreamHealth } from './useOptionStreamHealth';

// How long the ticker-tape banner stays up after a reconnect is first seen.
const BANNER_DISPLAY_MS = 15_000;

/**
 * Turns `useOptionStreamHealth`'s polled `last_reconnect_at` timestamp into
 * a one-shot, auto-dismissing EVENT — "the option price feed just
 * reconnected" — instead of a value the UI would otherwise have to notice
 * changed on its own.
 *
 * Honest limits of this, since it's polling (every 15s — see
 * useOptionStreamHealth), not a push: a reconnect can be up to one poll
 * interval old by the time `visible` flips true, and
 * `consecutive_verify_failures` (also on the health payload) hits 3 and
 * resets to 0 in the same instant a reconnect fires — a poll can't reliably
 * catch "about to reconnect" by watching that counter climb, only
 * `last_reconnect_at` actually changing is a dependable signal. There is no
 * real-time push for this today; if that's ever worth adding, it'd ride the
 * existing price-stream WebSocket (useMarketStream) as a new message type
 * rather than a new channel.
 *
 * The FIRST poll of a session never counts as "just happened," no matter
 * how recent `last_reconnect_at` looks — a reconnect from before this
 * screen ever mounted (e.g. ten minutes ago, while the user was elsewhere
 * in the app) isn't a fresh event, it's a fact about history. Only a value
 * that changes on a LATER poll, after a baseline has been recorded, shows
 * the banner.
 */
export function useOptionStreamReconnectEvent() {
  const { data } = useOptionStreamHealth();
  const baselineSetRef = useRef(false);
  const seenAtRef = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!data) return; // still loading / errored — nothing to compare yet
    const current = data.last_reconnect_at;

    if (!baselineSetRef.current) {
      baselineSetRef.current = true;
      seenAtRef.current = current;
      return;
    }

    if (current && current !== seenAtRef.current) {
      seenAtRef.current = current;
      setVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setVisible(false), BANNER_DISPLAY_MS);
    }
  }, [data]);

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  return { visible, reconnectCount: data?.reconnect_count ?? 0 };
}
