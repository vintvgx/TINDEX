import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface ORBServiceStatus {
  running: boolean;
  calculation_phase?: boolean;
  active_tickers?: string[];
  orb_ranges_count?: number;
  live_since?: string | null;
  toggle?: boolean;
}

export interface ContractsServiceStatus {
  running: boolean;
  poll_interval_seconds?: number;
  market_hours_only?: boolean;
  live_since?: string | null;
  toggle?: boolean;
}

/** Always-on infra streams — status-only, no start/stop toggle (see backend). */
export interface InfraStreamStatus {
  running: boolean;
  clients?: number;
  toggle?: boolean;
  error?: string;
  /** option_quote_stream only — subscribe-on-demand (a symbol only streams
   *  while a position is open or a verify_stream probe is running), so an
   *  empty/old last_quote_age_seconds with subscribed_count=0 is normal
   *  idle state, not an outage. `stale` is already computed server-side
   *  against that distinction — see monitoring_routes.py's
   *  OPTION_STREAM_STALE_THRESHOLD_SEC. */
  subscribed_count?: number;
  subscribed_symbols?: string[];
  /** OCC symbols still subscribed whose parsed expiry date is already in the
   *  past — proof a close/exit path didn't unsubscribe. Subscriptions are
   *  additive on Alpaca's side with no automatic expiry, so a nonzero count
   *  here means the connection is slowly leaking toward the account's
   *  channel cap. See option_stream.py's get_health(). */
  expired_count?: number;
  expired_symbols?: string[];
  /** Subscribed but not backing any currently-open position — safe to
   *  unsubscribe. See the "Clear Unused" action on the Service Status screen. */
  unused_count?: number;
  subscriptions?: OptionStreamSubscription[];
  last_quote_age_seconds?: number | null;
  stale?: boolean;
}

/** Per-symbol row for the Service Status screen's subscription list. */
export interface OptionStreamSubscription {
  symbol: string;
  /** Backing an open position right now — unsubscribing blinds its TP/SL monitoring. */
  in_use: boolean;
  /** Parsed OCC expiry is already in the past — should have been unsubscribed on close. */
  expired: boolean;
  last_quote_age_seconds: number | null;
  quote_count: number;
}

export interface ServicesStatus {
  orb: ORBServiceStatus;
  contracts: ContractsServiceStatus;
  option_quote_stream: InfraStreamStatus;
  price_stream: InfraStreamStatus;
  social_signals_price_stream: InfraStreamStatus;
}

const FALLBACK: ServicesStatus = {
  orb: { running: false, toggle: true },
  contracts: { running: false, toggle: true },
  option_quote_stream: { running: false, toggle: false },
  price_stream: { running: false, toggle: false },
  social_signals_price_stream: { running: false, toggle: false },
};

function isWithinServiceHours(): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    let hour: number | null = null;
    let minute: number | null = null;
    for (const p of parts) {
      if (p.type === 'hour'   && hour   === null) hour   = parseInt(p.value, 10);
      if (p.type === 'minute' && minute === null) minute = parseInt(p.value, 10);
    }
    if (hour === null || minute === null) return false;
    const cur = hour * 60 + minute;
    return cur >= 9 * 60 && cur < 17 * 60;
  } catch {
    return false;
  }
}

/**
 * Poll /services/status. By default only polls during market hours (9 AM –
 * 5 PM ET), matching the existing in-app status indicators this hook backs.
 * Pass `alwaysPoll: true` for the admin Service Status screen — the whole
 * point of that screen is to show what's running (or silently isn't) at any
 * time of day, not just during the trading session.
 * React Query deduplicates this across components — safe to call from multiple screens.
 */
export function useServicesStatus(options: { alwaysPoll?: boolean } = {}) {
  const { alwaysPoll = false } = options;
  const [isServiceHours, setIsServiceHours] = useState(() => isWithinServiceHours());

  useEffect(() => {
    setIsServiceHours(isWithinServiceHours());
    const id = setInterval(() => setIsServiceHours(isWithinServiceHours()), 60_000);
    return () => clearInterval(id);
  }, []);

  const shouldPoll = alwaysPoll || isServiceHours;

  return useQuery<ServicesStatus>({
    queryKey: ['services-status'],
    queryFn: async (): Promise<ServicesStatus> => {
      const res = await fetch(`${RAILWAY_BASE_URL}/services/status`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Services status fetch failed: ${res.statusText}`);
      return res.json();
    },
    enabled: shouldPoll,
    staleTime: 10_000,
    refetchInterval: shouldPoll ? 10_000 : false,
    placeholderData: FALLBACK,
    retry: 2,
    retryDelay: 1000,
  });
}
