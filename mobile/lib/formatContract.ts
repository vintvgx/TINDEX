/**
 * OCC option symbol parser and formatter.
 *
 * OCC format: {ROOT}{YY}{MM}{DD}{C|P}{8-digit-strike-in-thousandths}
 * Example:    QQQ260611C00699000
 *              → ticker=QQQ  expiry=2026-06-11  type=C  strike=$699
 *
 * Display format (retail standard):
 *   "QQQ $699C 0DTE"    — when expiry is today
 *   "QQQ $699C Jun 11"  — same calendar year
 *   "QQQ $699C Jun 11, 2027" — different year
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface ParsedContract {
  ticker:     string;
  year:       number;
  month:      number;
  day:        number;
  type:       'C' | 'P';
  strike:     number;
  expiry:     Date;
  isZeroDTE:  boolean;
}

export function parseContractSymbol(symbol: string): ParsedContract | null {
  const match = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;

  const [, ticker, yy, mm, dd, type, strikeRaw] = match;
  const year   = 2000 + parseInt(yy, 10);
  const month  = parseInt(mm, 10);
  const day    = parseInt(dd, 10);
  const strike = parseInt(strikeRaw, 10) / 1000;
  const expiry = new Date(year, month - 1, day);

  const now = new Date();
  const isZeroDTE =
    expiry.getFullYear() === now.getFullYear() &&
    expiry.getMonth()    === now.getMonth()    &&
    expiry.getDate()     === now.getDate();

  return { ticker, year, month, day, type: type as 'C' | 'P', strike, expiry, isZeroDTE };
}

export type TradeHorizon = 'ODTE' | 'WEEKLY' | 'SWING';

/**
 * Sort rank so 0DTE/weekly positions always list above swing trades in any
 * combined position list — a multi-day hold's SL/TP levels don't need the
 * same minute-to-minute attention a same-day or weekly contract does, and
 * shouldn't crowd it out at the top of the list.
 */
export const TRADE_HORIZON_RANK: Record<TradeHorizon, number> = { ODTE: 0, WEEKLY: 1, SWING: 2 };

/**
 * Classifies a contract's holding-period bucket from days between `from` (the
 * entry date) and expiry: 0 days → 0DTE, 1-7 → WEEKLY, 8+ → SWING (an
 * intentional multi-day/LEAPS hold). Unknown/unparseable symbols default to
 * ODTE — the most urgent bucket — so a bad symbol never accidentally hides a
 * position at the bottom of a sorted list.
 *
 * `from` defaults to today, which is what an OPEN position wants (it
 * classifies by days remaining). A CLOSED trade must instead pass its own
 * entry date — the classification is fixed at entry and shouldn't flip to
 * 0DTE just because expiry is now in the past.
 */
export function getTradeHorizon(symbol: string, from?: string | Date): TradeHorizon {
  const parsed = parseContractSymbol(symbol);
  if (!parsed) return 'ODTE';

  let refYear: number, refMonth: number, refDay: number;
  if (typeof from === 'string') {
    // Parse the "YYYY-MM-DD" calendar date directly instead of routing
    // through `new Date(string)` (which parses as UTC midnight) plus local
    // getters — that combination silently shifts the day back for anyone
    // west of UTC, which is exactly the class of TZ bug that mis-dated
    // trades in the backend earlier (see the session_date fix).
    const [y, m, d] = from.slice(0, 10).split('-').map(Number);
    refYear = y; refMonth = m - 1; refDay = d;
  } else {
    const ref = from ?? new Date();
    refYear = ref.getFullYear(); refMonth = ref.getMonth(); refDay = ref.getDate();
  }
  const refUTCms    = Date.UTC(refYear, refMonth, refDay);
  const expiryUTCms = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const daysToExpiry = Math.round((expiryUTCms - refUTCms) / 86_400_000);
  if (daysToExpiry <= 0) return 'ODTE';
  if (daysToExpiry <= 7) return 'WEEKLY';
  return 'SWING';
}

function fmtStrike(strike: number): string {
  if (strike % 1 === 0)      return `$${strike}`;
  if (strike % 0.5 === 0)    return `$${strike.toFixed(1)}`;
  return `$${strike.toFixed(2)}`;
}

/**
 * Returns a human-readable contract label.
 * @example
 *   formatContractSymbol("QQQ260611C00699000")  // "QQQ $699C 0DTE"
 *   formatContractSymbol("SPY260612P00730000")   // "SPY $730P Jun 12"
 */
export function formatContractSymbol(symbol: string): string {
  const parsed = parseContractSymbol(symbol);
  if (!parsed) return symbol;

  const { ticker, year, month, day, type, strike, isZeroDTE } = parsed;

  const now      = new Date();
  const showYear = year !== now.getFullYear();
  const dateStr  = isZeroDTE
    ? '0DTE'
    : showYear
      ? `${MONTHS[month - 1]} ${day}, ${year}`
      : `${MONTHS[month - 1]} ${day}`;

  return `${ticker} ${fmtStrike(strike)}${type} ${dateStr}`;
}

/**
 * Short form for tight spaces (e.g. live position header).
 * @example  "QQQ699C 0DTE"  or  "QQQ699C Jun 11"
 */
export function formatContractSymbolShort(symbol: string): string {
  const parsed = parseContractSymbol(symbol);
  if (!parsed) return symbol;

  const { ticker, year, month, day, type, strike, isZeroDTE } = parsed;

  const now      = new Date();
  const showYear = year !== now.getFullYear();
  const dateStr  = isZeroDTE
    ? '0DTE'
    : showYear
      ? `${MONTHS[month - 1]} ${day} '${String(year).slice(2)}`
      : `${MONTHS[month - 1]} ${day}`;

  const strikeStr = strike % 1 === 0 ? `${strike}` : `${strike.toFixed(1)}`;
  return `${ticker} ${strikeStr}${type} ${dateStr}`;
}
