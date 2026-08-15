import { useEffect, useRef } from 'react';
import { useORBStatus } from '@/hooks/queries/orb/useORBStatus';
import { useToast } from '@/common/components/ui/Toast';
import { isMarketHours } from '@/lib/marketHours';

const ALERT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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
