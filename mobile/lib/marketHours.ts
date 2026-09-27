/** Current ET wall-clock time, parsed once and shared by every check below. */
function getETNow(): { weekday: string; hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());

    let weekday: string | null = null;
    let hour: number | null = null;
    let minute: number | null = null;

    for (const p of parts) {
      if (p.type === 'weekday') weekday = p.value;
      if (p.type === 'hour')    hour    = parseInt(p.value, 10);
      if (p.type === 'minute')  minute  = parseInt(p.value, 10);
    }

    if (!weekday || hour === null || minute === null) return null;
    return { weekday, hour, minute };
  } catch {
    return null;
  }
}

/** Returns true if the current ET time is within market hours (Mon–Fri, 9:15 AM–4:15 PM). */
export function isMarketHours(): boolean {
  const et = getETNow();
  if (!et) return false;
  if (['Sat', 'Sun'].includes(et.weekday)) return false;

  const mins = et.hour * 60 + et.minute;
  return mins >= 9 * 60 + 15 && mins < 16 * 60 + 15;
}

/** Returns true once it's at/after 8:30 AM ET — the Market Digest's own
 *  cron schedule (see supabase/migrations/20260902_market_digest_cron.sql).
 *  Used to keep the Home card's "not generated yet" fallback — and its
 *  on-demand generate button — from appearing overnight, before there's
 *  anything for the digest to meaningfully report yet. */
export function isPastMarketDigestTime(): boolean {
  const et = getETNow();
  if (!et) return false;
  return et.hour * 60 + et.minute >= 8 * 60 + 30;
}
