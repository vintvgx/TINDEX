export interface FlowAlert {
  ticker: string;
  underlying_type: string;
  contract_type: 'call' | 'put';
  strike: string;           // string from API — use parseFloat()
  expiry: string;           // 'YYYY-MM-DD'
  price: string;            // fill price per contract
  size: number;
  premium: string;          // total dollar value = price × size × 100
  bid: string;
  ask: string;
  implied_volatility: string;
  delta: string;
  volume: number;
  open_interest: number;
  side: 'ask' | 'bid';     // ask = aggressive buy, bid = aggressive sell
  is_sweep: boolean;
  is_floor: boolean;
  is_multileg: boolean;
  tags: string[];
  unusual_score: string;
  timestamp: string;
  all_opening?: boolean;
  sector?: string | null;
  alert_rule?: string;
}

export interface FlowSummary {
  callPremium: number;
  putPremium: number;
  callCount: number;
  putCount: number;
  bias: 'Bullish' | 'Bearish' | 'Neutral';
  biasStrength: number; // 0–100, how dominant the leading side is
}

export function computeFlowSummary(alerts: FlowAlert[]): FlowSummary {
  let callPremium = 0;
  let putPremium = 0;
  let callCount = 0;
  let putCount = 0;

  for (const a of alerts) {
    const p = parseFloat(a.premium) || 0;
    if (a.contract_type === 'call') {
      callPremium += p;
      callCount++;
    } else {
      putPremium += p;
      putCount++;
    }
  }

  const total = callPremium + putPremium;
  let bias: FlowSummary['bias'] = 'Neutral';
  let biasStrength = 50;

  if (total > 0) {
    const callPct = (callPremium / total) * 100;
    if (callPct >= 60) { bias = 'Bullish'; biasStrength = Math.round(callPct); }
    else if (callPct <= 40) { bias = 'Bearish'; biasStrength = Math.round(100 - callPct); }
    else { bias = 'Neutral'; biasStrength = 50; }
  }

  return { callPremium, putPremium, callCount, putCount, bias, biasStrength };
}

export function formatPremium(raw: string | number): string {
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (isNaN(n)) return '$—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
