/** Returns true if the current ET time is within market hours (Mon–Fri, 9:15 AM–4:15 PM). */
export function isMarketHours(): boolean {
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
