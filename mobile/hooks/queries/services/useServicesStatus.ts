import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface ORBServiceStatus {
  running: boolean;
  calculation_phase?: boolean;
  active_tickers?: string[];
  orb_ranges_count?: number;
}

export interface ContractsServiceStatus {
  running: boolean;
  poll_interval_seconds?: number;
  market_hours_only?: boolean;
}

export interface ServicesStatus {
  orb: ORBServiceStatus;
  contracts: ContractsServiceStatus;
}

const FALLBACK: ServicesStatus = {
  orb: { running: false },
  contracts: { running: false },
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
 * Poll /services/status during market hours (9 AM – 5 PM ET).
 * Returns combined status for all registered backend services.
 * React Query deduplicates this across components — safe to call from multiple screens.
 */
export function useServicesStatus() {
  const [isServiceHours, setIsServiceHours] = useState(() => isWithinServiceHours());

  useEffect(() => {
    setIsServiceHours(isWithinServiceHours());
    const id = setInterval(() => setIsServiceHours(isWithinServiceHours()), 60_000);
    return () => clearInterval(id);
  }, []);

  return useQuery<ServicesStatus>({
    queryKey: ['services-status'],
    queryFn: async (): Promise<ServicesStatus> => {
      const res = await fetch(`${RAILWAY_BASE_URL}/services/status`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Services status fetch failed: ${res.statusText}`);
      return res.json();
    },
    enabled: isServiceHours,
    staleTime: 30_000,
    refetchInterval: isServiceHours ? 10_000 : false,
    placeholderData: FALLBACK,
    retry: 2,
    retryDelay: 1000,
  });
}
