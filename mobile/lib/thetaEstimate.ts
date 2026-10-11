/**
 * Theta ESTIMATE for an open option position (theta readout, 2026-10-11).
 * No live greeks on the current feed (Alpaca's are paid-only, Tradier is
 * unwired), so this spreads the contract's extrinsic value linearly over the
 * hours it has left:
 *
 *   intrinsic  = max(0, ±(underlying − strike))
 *   extrinsic  = max(0, premium − intrinsic)
 *   hours_left = 16:00 ET − now            (0DTE)
 *              = DTE × 6.5                 (DTE > 0)
 *   theta_est  = −extrinsic / hours_left   ($/hr, premium units)
 *
 * Linear understates late-day decay — the honest direction to err for a
 * warning. Always shown labeled "est.". Returns null whenever it shouldn't
 * show: extrinsic ≤ $0.02, DTE > 2, or outside 9:30–16:00 ET on a weekday.
 */

export interface ThetaEstimate {
  /** $/hr per share (negative). */
  perHour: number;
  /** |perHour| / premium — fraction of the premium lost per hour. */
  pctPerHour: number;
}

/** "SPY251011C00781000" → { cp, strike, expiry: "2025-10-11" }. */
export function parseOcc(symbol: string | null | undefined) {
  const m = (symbol ?? '').match(/(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, yy, mm, dd, cp, strike] = m;
  return { cp: cp as 'C' | 'P', strike: Number(strike) / 1000, expiry: `20${yy}-${mm}-${dd}` };
}

function etParts(now: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    weekday: get('weekday'),
  };
}

export function estimateTheta(opts: {
  contract: string | null | undefined;
  premium: number | null | undefined;
  underlying: number | null | undefined;
  now?: Date;
}): ThetaEstimate | null {
  const occ = parseOcc(opts.contract);
  const { premium, underlying } = opts;
  if (!occ || premium == null || premium <= 0 || underlying == null || underlying <= 0) return null;

  const et = etParts(opts.now ?? new Date());
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (et.weekday === 'Sat' || et.weekday === 'Sun' || et.minutes < open || et.minutes >= close) return null;

  const dte = Math.round((Date.parse(`${occ.expiry}T00:00:00Z`) - Date.parse(`${et.date}T00:00:00Z`)) / 86_400_000);
  if (dte < 0 || dte > 2) return null;

  const intrinsic = Math.max(0, occ.cp === 'C' ? underlying - occ.strike : occ.strike - underlying);
  const extrinsic = Math.max(0, premium - intrinsic);
  if (extrinsic <= 0.02) return null;

  const hoursLeft = dte === 0 ? (close - et.minutes) / 60 : dte * 6.5;
  if (hoursLeft <= 0) return null;
  const perHour = -(extrinsic / hoursLeft);
  return { perHour, pctPerHour: Math.abs(perHour) / premium };
}
