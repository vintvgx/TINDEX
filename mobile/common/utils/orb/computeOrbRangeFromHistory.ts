import type { TickerHistoryData } from '@/common/types/blogPosts/ticker';

/**
 * Client-side fallback ORB range, computed from a chart's own 1D bars — for
 * a ticker with no orb_ranges row today (e.g. an ad-hoc immediate trade that
 * was never ORB-followed, or any ticker just being looked up in the chart
 * that isn't part of an active strategy). Takes the high/low across
 * whichever bars fall in the 09:30-09:45 ET window. Coarser than the
 * backend's own 1-min-bar range when the chart is on 5-min bars, but needs
 * no backend dependency at all.
 */
export function computeOrbRangeFromHistory(
  data: TickerHistoryData | undefined,
): { orb_high: number; orb_low: number } | null {
  if (!data?.dates?.length || !data.highs?.length || !data.lows?.length) return null;
  let hi = -Infinity;
  let lo = Infinity;
  let found = false;
  for (let i = 0; i < data.dates.length; i++) {
    const d = new Date(data.dates[i]);
    const etParts = d.toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hh, mm] = etParts.split(':').map(Number);
    const minutesSinceMidnight = hh * 60 + mm;
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
