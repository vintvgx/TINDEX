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
