import { useEffect, useRef } from 'react';
import { useORBStatus } from '@/hooks/queries/orb/useORBStatus';
import { useToast } from '@/common/components/ui/Toast';

const ALERT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** Returns true if the current ET time is within market hours (Mon–Fri, 9:15 AM–4:15 PM). */
function isMarketHours(): boolean {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);

    let weekday: string | null = null;
    let hour: number | null = null;
    let minute: number | null = null;

    for (const p of parts) {
      if (p.type === 'weekday') weekday = p.value;
      if (p.type === 'hour')    hour    = parseInt(p.value, 10);
      if (p.type === 'minute')  minute  = parseInt(p.value, 10);
    }

    if (!weekday || hour === null || minute === null) return false;
    if (['Sat', 'Sun'].includes(weekday)) return false;

    const mins = hour * 60 + minute;
    return mins >= 9 * 60 + 15 && mins < 16 * 60 + 15;
  } catch {
    return false;
  }
}

/**
 * Monitors the ORB service during market hours and fires a toast warning
 * once per hour while the service remains stopped.
 *
 * Returns:
 *   serviceDown   — true when service is not running during market hours
 *   isMarketHours — true when we are within 9:15 AM–4:15 PM ET Mon–Fri
 */
export function useOrbServiceAlert(): { serviceDown: boolean; isMarketHours: boolean } {
  const toast = useToast();
  const { data: status } = useORBStatus();

  const lastAlertRef  = useRef<number>(0);
  const marketHours   = isMarketHours();
  const serviceDown   = marketHours && status !== undefined && !status.running;

  useEffect(() => {
    if (!serviceDown) return;

    const fire = () => {
      const now = Date.now();
      if (now - lastAlertRef.current >= ALERT_INTERVAL_MS) {
        lastAlertRef.current = now;
        toast.warning('ORB service is not running during market hours. Open Admin to start it.');
      }
    };

    // Fire immediately on first detection
    fire();

    // Then repeat every hour while service remains down
    const id = setInterval(fire, ALERT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [serviceDown]); // eslint-disable-line react-hooks/exhaustive-deps

  return { serviceDown, isMarketHours: marketHours };
}
