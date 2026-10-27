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

/** Strictly the regular options session — Mon–Fri, 9:30 AM–4:00 PM ET
 *  (no buffer, unlike isMarketHours). Used to tell "the market is closed"
 *  apart from a genuinely dead price feed when an entry can't verify a live
 *  quote. Holidays aren't modelled. */
export function isOptionsSessionOpen(): boolean {
  const et = getETNow();
  if (!et) return false;
  if (['Sat', 'Sun'].includes(et.weekday)) return false;
  const mins = et.hour * 60 + et.minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
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

/** An option expiring `expiration` (YYYY-MM-DD) has stopped trading: its
 *  date is past in ET, or it's that date and the 4:00 PM ET close has hit.
 *  Holidays aren't modelled. */
export function isOptionExpired(expiration: string): boolean {
  const day = expiration?.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const today = `${get('year')}-${get('month')}-${get('day')}`;
    if (today !== day) return today > day;
    return Number(get('hour')) % 24 >= 16;
  } catch {
    return false;
  }
}

/** True outside the live session (Mon–Fri 9:15 AM–4:15 PM ET) when `fetchedAt`
 *  (epoch ms) is after the most recent 4:15 PM ET weekday close — data from
 *  then holds the session's final bars and won't change until the next open.
 *  Mirrors the backend's _fetched_since_close. Holidays aren't modelled. */
export function fetchedSinceClose(fetchedAt: number): boolean {
  if (!fetchedAt || isMarketHours()) return false;
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const [y, mo, d, h, mi] = ['year', 'month', 'day', 'hour', 'minute'].map((t) => Number(get(t)));
    // ET wall clock as if it were UTC, minus "now" → ET's UTC offset.
    const etAsUtc = Date.UTC(y, mo - 1, d, h % 24, mi);
    const offsetMs = etAsUtc - Math.floor(now.getTime() / 60_000) * 60_000;
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let dow = weekdays.indexOf(get('weekday'));
    let close = Date.UTC(y, mo - 1, d, 16, 15);
    while (close > etAsUtc || dow === 0 || dow === 6) {
      close -= 86_400_000;
      dow = (dow + 6) % 7;
    }
    return fetchedAt >= close - offsetMs;
  } catch {
    return false;
  }
}
