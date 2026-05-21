import { parse, isValid } from 'date-fns';

export interface ParsedPlaidOption {
  underlying: string | null;
  expiry: Date | null;
  expiryStr: string | null;
  callPut: 'call' | 'put' | null;
  strike: number | null;
  raw: string;
}

const EMPTY: Omit<ParsedPlaidOption, 'raw'> = {
  underlying: null,
  expiry: null,
  expiryStr: null,
  callPut: null,
  strike: null,
};

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// OCC 21-char symbol: "AAPL  261218C00195000"
function tryOcc(raw: string): Omit<ParsedPlaidOption, 'raw'> | null {
  const clean = raw.replace(/\s+/g, '');
  // OCC: up to 6-char ticker + 6-char date (YYMMDD) + C/P + 8-digit strike
  const m = clean.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/i);
  if (!m) return null;

  const [, ticker, dateStr, cp, strikeRaw] = m;
  const year = 2000 + parseInt(dateStr.slice(0, 2), 10);
  const month = parseInt(dateStr.slice(2, 4), 10) - 1;
  const day = parseInt(dateStr.slice(4, 6), 10);
  const expiry = new Date(year, month, day);
  if (!isValid(expiry)) return null;

  return {
    underlying: ticker.toUpperCase(),
    expiry,
    expiryStr: fmtDate(expiry),
    callPut: cp.toUpperCase() === 'C' ? 'call' : 'put',
    strike: parseInt(strikeRaw, 10) / 1000,
  };
}

// ISO date: "AAPL 2026-12-18 call $195.00"
function tryIsoDate(raw: string): Omit<ParsedPlaidOption, 'raw'> | null {
  const m = raw.match(
    /^([A-Z]{1,5})\s+(\d{4}-\d{2}-\d{2})\s+(call|put|c|p)\s+\$?([\d.]+)/i,
  );
  if (!m) return null;

  const [, ticker, dateStr, cpRaw, strikeStr] = m;
  const expiry = parse(dateStr, 'yyyy-MM-dd', new Date());
  if (!isValid(expiry)) return null;

  const cpLow = cpRaw.toLowerCase();
  return {
    underlying: ticker.toUpperCase(),
    expiry,
    expiryStr: fmtDate(expiry),
    callPut: cpLow === 'call' || cpLow === 'c' ? 'call' : 'put',
    strike: parseFloat(strikeStr),
  };
}

// Slash date: "AAPL 12/18/2026 call $195.00"
function trySlashDate(raw: string): Omit<ParsedPlaidOption, 'raw'> | null {
  const m = raw.match(
    /^([A-Z]{1,5})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(call|put|c|p)\s+\$?([\d.]+)/i,
  );
  if (!m) return null;

  const [, ticker, dateStr, cpRaw, strikeStr] = m;
  const expiry = parse(dateStr, 'MM/dd/yyyy', new Date());
  if (!isValid(expiry)) return null;

  const cpLow = cpRaw.toLowerCase();
  return {
    underlying: ticker.toUpperCase(),
    expiry,
    expiryStr: fmtDate(expiry),
    callPut: cpLow === 'call' || cpLow === 'c' ? 'call' : 'put',
    strike: parseFloat(strikeStr),
  };
}

// Month-name date: "AAPL Dec 18 2026 call 195" or "AAPL Dec 2026 call 195"
const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

function tryMonthName(raw: string): Omit<ParsedPlaidOption, 'raw'> | null {
  // With day: "AAPL Dec 18 2026 call $195"
  let m = raw.match(
    /^([A-Z]{1,5})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})\s+(call|put|c|p)\s+\$?([\d.]+)/i,
  );
  if (m) {
    const [, ticker, mon, dayStr, yearStr, cpRaw, strikeStr] = m;
    const month = MONTHS.indexOf(mon.toLowerCase());
    const expiry = new Date(parseInt(yearStr, 10), month, parseInt(dayStr, 10));
    if (!isValid(expiry)) return null;
    const cpLow = cpRaw.toLowerCase();
    return {
      underlying: ticker.toUpperCase(),
      expiry,
      expiryStr: fmtDate(expiry),
      callPut: cpLow === 'call' || cpLow === 'c' ? 'call' : 'put',
      strike: parseFloat(strikeStr),
    };
  }

  // Without day (third Friday assumed, just store month-end): "AAPL Dec 2026 call $195"
  m = raw.match(
    /^([A-Z]{1,5})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(call|put|c|p)\s+\$?([\d.]+)/i,
  );
  if (m) {
    const [, ticker, mon, yearStr, cpRaw, strikeStr] = m;
    const month = MONTHS.indexOf(mon.toLowerCase());
    const expiry = new Date(parseInt(yearStr, 10), month, 1);
    if (!isValid(expiry)) return null;
    const cpLow = cpRaw.toLowerCase();
    return {
      underlying: ticker.toUpperCase(),
      expiry,
      expiryStr: fmtDate(expiry),
      callPut: cpLow === 'call' || cpLow === 'c' ? 'call' : 'put',
      strike: parseFloat(strikeStr),
    };
  }

  return null;
}

// Company name prefix: "Apple Inc 12/18/2026 Call $195.00" — strip name, re-parse date+cp+strike
function tryCompanyName(raw: string): Omit<ParsedPlaidOption, 'raw'> | null {
  const m = raw.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})\s+(call|put)\s+\$?([\d.]+)/i,
  );
  if (!m) return null;

  const [, dateStr, cpRaw, strikeStr] = m;
  const expiry = parse(dateStr, 'MM/dd/yyyy', new Date());
  if (!isValid(expiry)) return null;

  return {
    underlying: null, // can't reliably extract from company name
    expiry,
    expiryStr: fmtDate(expiry),
    callPut: cpRaw.toLowerCase() as 'call' | 'put',
    strike: parseFloat(strikeStr),
  };
}

const STRATEGIES = [tryOcc, tryIsoDate, trySlashDate, tryMonthName, tryCompanyName];

export function parsePlaidOptionName(name: string): ParsedPlaidOption {
  const trimmed = name.trim();
  for (const strategy of STRATEGIES) {
    const result = strategy(trimmed);
    if (result) return { ...result, raw: trimmed };
  }
  return { ...EMPTY, raw: trimmed };
}

export function isOptionSecurity(securityType: string): boolean {
  return securityType === 'derivative';
}
