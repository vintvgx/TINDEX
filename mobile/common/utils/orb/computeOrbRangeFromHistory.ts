import type { TickerHistoryData } from '@/common/types/blogPosts/ticker';

/**
 * Client-side fallback ORB range — for a ticker with no orb_ranges row
 * (e.g. an ad-hoc trade that was never ORB-followed, or weekends/holidays
 * when the engine never ran). Computed from the LAST trading day in the
 * dataset only: the high/low across that morning's 09:30-09:45 ET bars.
 *
 * (An earlier version took the extremes across every 09:30-09:45 window in
 * the whole dataset — fine for 1 day of bars, wildly wrong once the chart
 * lazy-loads a month of history.)
 */
export function computeOrbRangeFromHistory(
  data: TickerHistoryData | undefined,
): { orb_high: number; orb_low: number } | null {
  if (!data?.dates?.length || !data.highs?.length || !data.lows?.length) return null;
  const etDay = (ds: string) =>
    new Date(ds).toLocaleString('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    });
  const etMins = (ds: string) => {
    const parts = new Date(ds).toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hh, mm] = parts.split(':').map(Number);
    return hh * 60 + mm;
  };
  // Last trading day present in the dataset (dates are ascending).
  const lastDay = etDay(data.dates[data.dates.length - 1]);
  if (!lastDay || lastDay.includes('NaN')) return null;
  let hi = -Infinity;
  let lo = Infinity;
  let found = false;
  for (let i = 0; i < data.dates.length; i++) {
    if (etDay(data.dates[i]) !== lastDay) continue;
    const minutesSinceMidnight = etMins(data.dates[i]);
    if (minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 9 * 60 + 45) {
      const h = data.highs[i];
      const l = data.lows[i];
      if (h != null) { hi = Math.max(hi, h); found = true; }
      if (l != null) { lo = Math.min(lo, l); found = true; }
    }
  }
  if (!found || hi === -Infinity || lo === Infinity) return null;
  return { orb_high: hi, orb_low: lo };
}
