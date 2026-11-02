// Trade Detail v2 view model (trade-logging-cascade-v2 brief §5).
//
// Turns one orb_trades row — with or without the v2 `log_v2` record — into
// display-ready sections where every value carries a provenance tag. This is
// the ONLY place that reads trade fields for the v2 card, so null-safety lives
// here: anything absent, null, NaN or the wrong type becomes MISSING rather
// than a blank, a "$NaN", or a crash. Inferred values (legacy legs, re-entry
// links derived from the day's trades) are tagged INFERRED with their basis,
// and are never rendered as fills.

import type { ORBTrade } from '@/common/types/strategy';
import type { PField, Provenance, TradeLogV2, V2Event } from '@/common/types/tradeLogV2';
import { PROVENANCE_ORDER } from '@/common/types/tradeLogV2';

export const NOVEMBER_BASELINE = '2026-11-01';

// ── Primitive guards / formatters ────────────────────────────────────────────

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const isProv = (x: unknown): x is Provenance => PROVENANCE_ORDER.includes(x as Provenance);

export const MISSING: PField<string> = { v: null, p: 'MISSING' };
const field = (v: string | null, p: Provenance, basis?: string | null): PField<string> =>
  v == null ? MISSING : { v, p, basis: basis ?? null };

export const fmtMoney = (n: number | null | undefined, signed = true): string => {
  if (!isNum(n)) return '—';
  const sign = !signed ? '' : n > 0.004 ? '+' : n < -0.004 ? '−' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
};
export const fmtPremium = (n: number | null | undefined): string => {
  if (!isNum(n)) return '—';
  // Three decimals only when the value actually has them (TP1 $1.547).
  return Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
};
const fmtPrice = (n: unknown): string | null => (isNum(n) ? `$${n.toFixed(2)}` : null);

const parseTime = (iso: unknown): Date | null => {
  if (!isStr(iso)) return null;
  // Timezone fix: the backend used to write exit_stages times as naive
  // UTC (datetime.utcnow().isoformat(), no offset) inside a JSONB blob,
  // while entry/exit timestamptz columns round-trip with +00:00. A naive
  // ISO string parses as PHONE-LOCAL time in JS, so in Boston (ET) a leg
  // stored at 15:14 UTC displayed as 3:14 PM labelled ET — 5h late
  // (true 10:14 AM ET), and leg clocks shifted with the phone's timezone
  // while entry clocks (forced America/New_York below) did not. Naive
  // strings are therefore UTC by construction: append 'Z' before parsing.
  // Offset-aware strings (all new writes, all timestamptz columns) are
  // untouched, so entry/exit clock behaviour does not change.
  const s = iso.trim();
  const hasOffset = /([+-]\d{2}:?\d{2}|[Zz])$/.test(s);
  const d = new Date(hasOffset ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const fmtEtClock = (iso: unknown): string | null => {
  const d = parseTime(iso);
  if (!d) return null;
  try {
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return null; }
};
const fmtSpan = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};

/** Normalise a v2 PField off the wire — anything malformed renders MISSING. */
const pf = (x: unknown, fmt: (v: any) => string | null = v => (v == null ? null : String(v))): PField<string> => {
  if (!x || typeof x !== 'object') return MISSING;
  const f = x as PField<any>;
  if (!isProv(f.p) || f.p === 'MISSING') return { ...MISSING, basis: isStr(f.basis) ? f.basis : null };
  const v = f.v == null ? null : fmt(f.v);
  return v == null ? MISSING : { v, p: f.p, basis: isStr(f.basis) ? f.basis : null };
};

// ── Labels ───────────────────────────────────────────────────────────────────

const REASON: Record<string, string> = {
  TP1: 'TP1', TP2: 'TP2', TP2_FULL_CLOSE: 'TP2',
  CASCADE_EXIT: 'Cascade', CASCADE_FIRE: 'Cascade',
  BREAKEVEN_STOP: 'Breakeven stop', RUNNER_FLOOR_STOP: 'Runner profit floor',
  RUNNER_TRAIL_STOP: 'Runner trailing stop', RUNNER_INVALIDATION: 'Runner exit · trend invalidated',
  HARD_STOP: 'Hard stop', HARD_STOP_FLOOR: 'Hard stop floor', TIME_STOP: 'Time stop',
  EOD_CLOSE: 'EOD close', EOD_HARD_CLOSE: 'EOD hard close',
  MANUAL_EXIT: 'Manual exit', MANUAL_CLOSE: 'Manual close', FORCE_CLOSE: 'Force closed',
  EXPIRED_WORTHLESS: 'Expired worthless', LOW_VOLUME_EXIT: 'Low volume exit',
  REVERSAL_TIME_CUT: 'Reversal bleed stop',
};
const reasonLabel = (code: unknown): string =>
  isStr(code) ? (REASON[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())) : 'Unknown reason';

const MANUAL_CODES = new Set(['MANUAL_EXIT', 'MANUAL_CLOSE', 'FORCE_CLOSE']);
const NON_EXIT_CODES = new Set(['ENTRY', 'CASCADE_CANDIDATE', 'CASCADE_BLOCKED', 'GATE_WATCH', 'WATCH_EXPIRED', 'GATE_BLOCK']);

/** Leg title: intermediate partials and the final close never share a label. */
function legTitle(code: unknown, qtyAfter: number | null): string {
  if (code === 'ENTRY') return 'Entry';
  if (code === 'CASCADE_CANDIDATE') return 'Cascade candidate';
  if (code === 'CASCADE_BLOCKED') return 'Cascade blocked';
  if (code === 'CASCADE_EXIT' || code === 'CASCADE_FIRE') return 'Cascade fired';
  const base = reasonLabel(code);
  if (qtyAfter == null) return base;
  return qtyAfter > 0 ? `${base} · partial` : `${base} · closed remainder`;
}

/** Headline for the whole trade — the final state, never a mid-trade partial. */
export function finalCloseLabel(trade: Pick<ORBTrade, 'exit_time' | 'exit_reason' | 'qty_entered' | 'qty_exited'>): string {
  const entered = isNum(trade.qty_entered) ? trade.qty_entered : null;
  const exited = isNum(trade.qty_exited) ? trade.qty_exited : 0;
  if (trade.exit_time == null) {
    return exited > 0 && entered != null ? `Open · ${exited} of ${entered} exited` : 'Open';
  }
  const reason = isStr(trade.exit_reason) ? reasonLabel(trade.exit_reason) : 'reason not logged';
  if (entered != null && exited >= entered) return `Closed in full · ${reason}`;
  return entered != null ? `Closed · ${exited} of ${entered} exited · ${reason}` : `Closed · ${reason}`;
}

/** Average exit across every closed contract — NOT the last leg's premium. */
export function avgExitPremium(trade: Pick<ORBTrade, 'entry_premium' | 'pnl' | 'qty_exited'>): number | null {
  if (!isNum(trade.entry_premium) || !isNum(trade.pnl) || !isNum(trade.qty_exited) || trade.qty_exited <= 0) return null;
  return trade.entry_premium + trade.pnl / (trade.qty_exited * 100);
}

// ── View model ───────────────────────────────────────────────────────────────

export interface VMRow { label: string; field: PField<string> }

export type LegKind = 'entry' | 'exit' | 'candidate' | 'blocked' | 'missing' | 'other';

export interface VMLeg {
  key: string;
  time: string | null;
  title: string;
  qtyText: string;
  p: Provenance;
  basis: string | null;
  kind: LegKind;
  qtyFlow: string | null;            // "4 → 2"
  underlying: string | null;
  legPnl: number | null;
  cumPnl: number | null;
  evidence: string | null;
  bars: { label: string; kind: 'against' | 'recovering' | 'doji' }[];
  blocked: string | null;
  manual: string | null;
  technicals: PField<string>;
}

export interface TradeDetailVM {
  headline: string;
  badges: { text: string; tone: 'warn' | 'muted' | 'error' }[];
  pnl: PField<string>;
  pnlValue: number | null;
  pnlLabel: string;
  unrealized: PField<string> | null;
  qtyText: string;
  timesText: string;
  durationText: string | null;
  entryPremium: PField<string>;
  avgExit: PField<string>;
  lastLeg: PField<string>;
  reentry: PField<string> | null;
  entry: VMRow[];
  composite: { total: PField<string>; rows: { factor: string; value: string; score: string }[]; missing: boolean };
  contract: VMRow[];
  config: VMRow[];
  legs: VMLeg[];
  cascadeNote: PField<string> | null;
  reconciliation: { ok: boolean; text: string; field: PField<string> } | null;
  outcome: VMRow[];
  postExit: VMRow[];
  classification: { question: string; answer: string }[] | null;
}

const COMPOSITE_FACTORS = ['Intraday RSI (5m)', 'Daily RSI', 'MACD (5m)', 'Intraday trend (5m EMA)', 'Daily trend', 'VWAP', 'ORB'];

const getV2 = (trade: ORBTrade): TradeLogV2 | null => {
  const x = (trade as ORBTrade & { log_v2?: unknown }).log_v2;
  return x && typeof x === 'object' ? (x as TradeLogV2) : null;
};

function techField(t: V2Event['technicals']): PField<string> {
  if (!t || typeof t !== 'object') return MISSING;
  const parts = [
    isNum(t.composite_total) ? `composite ${t.composite_total > 0 ? '+' : ''}${t.composite_total}${isStr(t.tier) ? ` ${t.tier}` : ''}` : null,
    isStr(t.vwap) ? `VWAP ${t.vwap}` : null,
    isStr(t.orb) ? `ORB ${t.orb}` : null,
    isStr(t.ema_5m) ? `EMA ${t.ema_5m}` : null,
    isNum(t.rsi_5m) ? `RSI5m ${t.rsi_5m.toFixed(1)}` : null,
    isStr(t.structure) ? t.structure : null,
  ].filter(Boolean);
  return parts.length ? { v: parts.join(' · '), p: 'ENGINE' } : MISSING;
}

function legKind(code: unknown, p: Provenance): LegKind {
  if (p === 'MISSING') return 'missing';
  if (code === 'ENTRY') return 'entry';
  if (code === 'CASCADE_CANDIDATE') return 'candidate';
  if (code === 'CASCADE_BLOCKED') return 'blocked';
  return isStr(code) && !NON_EXIT_CODES.has(code) ? 'exit' : 'other';
}

/** v2 events → legs. Every numeric field is guarded individually. */
function legsFromV2(events: V2Event[]): VMLeg[] {
  return events.filter(e => e && typeof e === 'object').map((e, i) => {
    const p: Provenance = isProv(e.p) ? e.p : 'MISSING';
    const qtyAfter = isNum(e.qty_after) ? e.qty_after : null;
    const ev = e.evidence && typeof e.evidence === 'object' ? e.evidence : null;
    const evidenceParts = ev ? [
      isNum(ev.peak) && isNum(ev.trigger) ? `peak ${fmtPremium(ev.peak)} → trigger ${fmtPremium(ev.trigger)}` : null,
      fmtEtClock(ev.deadline) ? `window closes ${fmtEtClock(ev.deadline)}` : null,
      isStr(ev.note) ? ev.note : null,
    ].filter(Boolean) : [];
    const bars = Array.isArray(ev?.bars) ? ev!.bars!.filter(b => b && typeof b === 'object').map(b => ({
      label: fmtEtClock(b.t)?.replace(/:\d\d (AM|PM)$/, ' $1') ?? 'bar',
      kind: (b.against ? 'against' : b.recovering ? 'recovering' : 'doji') as 'against' | 'recovering' | 'doji',
    })) : [];
    const closed = isNum(e.qty_closed) ? e.qty_closed : 0;
    const qtyText = e.code === 'ENTRY'
      ? `${isNum(e.qty_after) ? e.qty_after : '?'} @ ${fmtPremium(e.premium)}`
      : closed > 0 ? `${closed} @ ${fmtPremium(e.premium)}` : isNum(e.premium) ? `premium ${fmtPremium(e.premium)}` : 'premium —';
    const manual = e.manual && typeof e.manual === 'object'
      ? [isStr(e.manual.who) ? e.manual.who : null, isStr(e.manual.via) ? `via ${e.manual.via}` : null].filter(Boolean).join(' ') || null
      : null;
    return {
      key: `v2-${i}`,
      time: fmtEtClock(e.t),
      title: legTitle(e.code, closed > 0 ? qtyAfter : null),
      qtyText,
      p,
      basis: isStr(e.basis) ? e.basis : null,
      kind: legKind(e.code, p),
      qtyFlow: isNum(e.qty_before) && qtyAfter != null ? `${e.qty_before} → ${qtyAfter}` : null,
      underlying: fmtPrice(e.underlying),
      legPnl: closed > 0 && isNum(e.leg_pnl) ? e.leg_pnl : null,
      cumPnl: isNum(e.cum_pnl) ? e.cum_pnl : null,
      evidence: evidenceParts.length ? evidenceParts.join(' · ') : null,
      bars,
      blocked: isStr(e.blocked_reason) ? e.blocked_reason : null,
      manual,
      technicals: techField(e.technicals),
    };
  });
}

/** Pre-v2 rows: exit_stages (engine-written at decision time) or the
 *  tp1/tp2 columns, plus explicit MISSING / INFERRED legs for whatever the
 *  record cannot account for. */
function legsFromLegacy(trade: ORBTrade): VMLeg[] {
  const entry = isNum(trade.entry_premium) ? trade.entry_premium : null;
  const entered = isNum(trade.qty_entered) ? trade.qty_entered : null;
  const legs: VMLeg[] = [];
  const blank = { evidence: null, bars: [], blocked: null, manual: null, technicals: MISSING };

  legs.push({
    key: 'entry', time: fmtEtClock(trade.entry_time), title: 'Entry',
    qtyText: `${entered ?? '?'} @ ${fmtPremium(entry)}`, p: entry != null ? 'VERIFIED' : 'MISSING', basis: null,
    kind: 'entry', qtyFlow: entered != null ? `0 → ${entered}` : null,
    underlying: fmtPrice(trade.underlying_price_entry), legPnl: null, cumPnl: 0, ...blank,
  });

  type Raw = { reason: unknown; qty: number | null; premium: number | null; pnl: number | null; time: unknown; p: Provenance; basis: string | null };
  let raw: Raw[] = [];
  const stages = Array.isArray(trade.exit_stages) ? trade.exit_stages : [];
  if (stages.length) {
    raw = stages.filter(s => s && typeof s === 'object').map(s => ({
      reason: s.reason, qty: isNum(s.qty) ? s.qty : null, premium: isNum(s.premium) ? s.premium : null,
      pnl: isNum(s.pnl) ? s.pnl : null, time: s.time, p: 'VERIFIED', basis: null,
    }));
  } else {
    if (isNum(trade.tp1_qty) || isNum(trade.tp1_pnl)) raw.push({
      reason: 'TP1', qty: isNum(trade.tp1_qty) ? trade.tp1_qty : null, premium: isNum(trade.tp1_premium) ? trade.tp1_premium : null,
      pnl: isNum(trade.tp1_pnl) ? trade.tp1_pnl : null, time: null, p: 'VERIFIED', basis: 'From the TP1 columns; leg time not recorded.',
    });
    if (isNum(trade.tp2_qty) || isNum(trade.tp2_pnl)) raw.push({
      reason: 'TP2', qty: isNum(trade.tp2_qty) ? trade.tp2_qty : null, premium: isNum(trade.tp2_premium) ? trade.tp2_premium : null,
      pnl: isNum(trade.tp2_pnl) ? trade.tp2_pnl : null, time: null, p: 'VERIFIED', basis: 'From the TP2 columns; leg time not recorded.',
    });
    // Only the final exit fields exist for the rest — show that leg as an
    // inference from them, never as a fill.
    const accounted = raw.reduce((s, r) => s + (r.qty ?? 0), 0);
    const exited = isNum(trade.qty_exited) ? trade.qty_exited : 0;
    const finalCode = trade.exit_reason;
    const finalIsTp = finalCode === 'TP1' || finalCode === 'TP2' || finalCode === 'TP2_FULL_CLOSE';
    if (exited > accounted && !(finalIsTp && raw.length)) {
      const qty = exited - accounted;
      const prem = isNum(trade.exit_premium) ? trade.exit_premium : null;
      raw.push({
        reason: finalCode ?? 'UNKNOWN', qty, premium: prem,
        pnl: prem != null && entry != null ? (prem - entry) * qty * 100 : null,
        time: trade.exit_time, p: 'INFERRED',
        basis: 'Only the final exit premium/reason were recorded; quantity is the remainder not covered by any leg record.',
      });
    }
  }

  // Contracts that left the position with no leg record at all (Oct 30
  // 10:16: qty_exited 3 = TP1 2 + an unlogged cascade 1). On a closed trade
  // they left before the final leg, so the gap row sits just ahead of it.
  const exited = isNum(trade.qty_exited) ? trade.qty_exited : 0;
  const legged = raw.reduce((s, r) => s + (r.qty ?? 0), 0);
  const unlogged = exited > legged ? exited - legged : 0;
  const fullyClosed = trade.exit_time != null && entered != null && exited >= entered;
  const gapAt = unlogged ? (fullyClosed && raw.length ? raw.length - 1 : raw.length) : -1;
  const gapLeg = (): VMLeg => ({
    key: 'unlogged', time: null, title: `${unlogged} contract${unlogged === 1 ? '' : 's'} exited with no leg record`,
    qtyText: `${unlogged} @ —`, p: 'MISSING', basis: 'qty_exited is higher than the sum of logged legs. Price, time and reason were not logged.',
    kind: 'missing', qtyFlow: null, underlying: null, legPnl: null, cumPnl: null, ...blank,
  });

  let remaining = entered;
  let cum = 0;
  let cumKnown = true;
  raw.forEach((r, i) => {
    if (i === gapAt) {
      legs.push(gapLeg());
      if (remaining != null) remaining = Math.max(0, remaining - unlogged);
      cumKnown = false;
    }
    const before = remaining;
    if (remaining != null && r.qty != null) remaining = Math.max(0, remaining - r.qty);
    // The final leg of a fully-closed trade closed the remainder, whatever
    // the arithmetic of incomplete leg records says.
    if (fullyClosed && i === raw.length - 1) remaining = 0;
    if (r.pnl == null) cumKnown = false; else cum += r.pnl;
    const p: Provenance = r.qty == null || r.premium == null ? (r.p === 'INFERRED' ? 'INFERRED' : 'MISSING') : r.p;
    legs.push({
      key: `stage-${i}`, time: fmtEtClock(r.time),
      title: legTitle(r.reason, r.qty != null ? remaining : null),
      qtyText: `${r.qty ?? '?'} @ ${fmtPremium(r.premium)}`, p, basis: r.basis,
      kind: MANUAL_CODES.has(String(r.reason)) ? 'exit' : legKind(r.reason, p),
      qtyFlow: before != null && remaining != null && r.qty != null ? `${before} → ${remaining}` : null,
      underlying: null, legPnl: r.pnl, cumPnl: cumKnown ? cum : null, ...blank,
    });
  });

  if (gapAt === raw.length) legs.push(gapLeg());
  return legs;
}

/** Previous trade in the same session on the same strategy + ticker + direction. */
function deriveReentry(trade: ORBTrade, dayTrades: ORBTrade[]): PField<string> | null {
  const start = parseTime(trade.entry_time);
  if (!start) return null;
  const sameStrategy = (o: ORBTrade) =>
    trade.strategy_id ? o.strategy_id === trade.strategy_id : o.profile === trade.profile;
  const prev = dayTrades
    .filter(o => o && o.id !== trade.id && o.ticker === trade.ticker && o.direction === trade.direction
      && o.trade_date?.slice(0, 10) === trade.trade_date?.slice(0, 10) && sameStrategy(o))
    .map(o => ({ o, exit: parseTime(o.exit_time) }))
    .filter(x => x.exit && x.exit.getTime() <= start.getTime())
    .sort((a, b) => b.exit!.getTime() - a.exit!.getTime())[0];
  if (!prev) return null;
  const mins = Math.round((start.getTime() - prev.exit!.getTime()) / 60000);
  const sameContract = prev.o.contract_symbol === trade.contract_symbol;
  return {
    v: `Follows ${prev.o.contract_symbol ?? 'the earlier trade'}, which exited on ${reasonLabel(prev.o.exit_reason)} at ${fmtEtClock(prev.o.exit_time) ?? '—'} ET. `
      + `This trade entered ${mins} min later. Same ticker + direction, ${sameContract ? 'same' : 'new'} contract. Cooldown and gate re-check: not logged.`,
    p: 'INFERRED',
    basis: 'Linked from the day\'s trade records (same strategy, ticker, direction). The engine does not log re-entry linkage before v2.',
  };
}

export function buildTradeDetailVM(trade: ORBTrade, dayTrades: ORBTrade[] = []): TradeDetailVM {
  const v2 = getV2(trade);
  const isOpen = trade.exit_time == null;
  const entry = isNum(trade.entry_premium) ? trade.entry_premium : null;
  const entered = isNum(trade.qty_entered) ? trade.qty_entered : null;
  const exited = isNum(trade.qty_exited) ? trade.qty_exited : 0;
  const isManualTrade = isStr(trade.trade_type) && trade.trade_type !== 'STRATEGY';

  // Legs
  const v2Events = Array.isArray(v2?.events) && v2!.events!.length ? v2!.events! : null;
  const legs = v2Events ? legsFromV2(v2Events) : legsFromLegacy(trade);
  const exitLegs = legs.filter(l => l.kind === 'exit' || (l.kind === 'missing' && l.key !== 'entry'));
  const lastPriced = [...legs].reverse().find(l => l.kind === 'exit');

  // Badges
  const badges: TradeDetailVM['badges'] = [];
  if (isStr(trade.trade_date) && trade.trade_date.slice(0, 10) < NOVEMBER_BASELINE) badges.push({ text: 'PRE-BASELINE', tone: 'muted' });
  if (isManualTrade) badges.push({ text: 'MANUAL TRADE · excluded from strategy stats', tone: 'warn' });
  else if (MANUAL_CODES.has(String(trade.exit_reason)) || (v2Events ?? []).some(e => MANUAL_CODES.has(String(e?.code)))) {
    badges.push({ text: 'MANUAL EXIT · not a clean system exit', tone: 'warn' });
  }

  // P&L
  const isPartial = isOpen && exited > 0;
  const pnlValue = isOpen && !isPartial ? (isNum(trade.live_pnl) ? trade.live_pnl : null) : (isNum(trade.pnl) ? trade.pnl : null);
  const pnlPct = isOpen && !isPartial ? trade.live_pnl_pct : trade.pnl_pct;
  const pnl: PField<string> = pnlValue == null ? MISSING : {
    v: `${fmtMoney(pnlValue)}${isNum(pnlPct) ? `  ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : ''}`,
    p: isOpen && !isPartial ? 'ESTIMATE' : 'VERIFIED',
    basis: isOpen && !isPartial ? 'Live quote, unrealized.' : null,
  };
  const unrealized = isPartial
    ? (isNum(trade.live_pnl) ? { v: fmtMoney(trade.live_pnl), p: 'ESTIMATE' as Provenance, basis: 'Live quote on the remaining contracts.' } : MISSING)
    : null;

  const entryT = fmtEtClock(trade.entry_time);
  const exitT = fmtEtClock(trade.exit_time);
  const tIn = parseTime(trade.entry_time), tOut = parseTime(trade.exit_time);

  const avg = avgExitPremium(trade);
  const lastLegPrem = lastPriced && lastPriced.p !== 'MISSING' ? lastPriced.qtyText.split('@ ')[1] ?? null : null;

  // Entry signal
  const e2 = v2?.entry ?? null;
  const orbRef = trade.direction === 'CALL' ? trade.orh : trade.orl;
  const legacySignal = isStr(trade.direction) && isNum(orbRef)
    ? field(`${trade.direction} breakout · closed ${trade.direction === 'CALL' ? 'above ORH' : 'below ORL'} $${orbRef.toFixed(2)}`, 'ENGINE')
    : MISSING;
  const flowLegacy: PField<string> = typeof trade.flow_confirmed === 'boolean'
    ? { v: trade.flow_confirmed ? 'Yes · no print details' : 'No', p: 'UNVERIFIED', basis: 'Only a yes/no was stored; no print size, strike, side or time.' }
    : MISSING;
  const entryRows: VMRow[] = [
    { label: 'Entered', field: field(entryT ? `${entryT} ET` : null, 'VERIFIED') },
    { label: 'Signal', field: e2?.signal ? pf(e2.signal) : legacySignal },
    { label: 'Trigger', field: pf(e2?.trigger) },
    { label: 'ORH / ORL', field: isNum(trade.orh) && isNum(trade.orl) ? field(`$${trade.orh.toFixed(2)} / $${trade.orl.toFixed(2)}`, 'ENGINE') : MISSING },
    { label: 'Underlying at entry', field: field(fmtPrice(trade.underlying_price_entry), 'ENGINE') },
    { label: 'Session VWAP', field: pf(e2?.vwap) },
    { label: 'VIX', field: field(isNum(trade.vix_at_entry) ? trade.vix_at_entry.toFixed(2) : null, 'ENGINE') },
    { label: 'Gate', field: pf(e2?.gate) },
    { label: 'Flow', field: e2?.flow ? pf(e2.flow) : flowLegacy },
    { label: 'Market', field: pf(e2?.market) },
  ];

  // Composite
  const c = v2?.composite;
  const rows = Array.isArray(c?.rows) ? c!.rows!.filter(r => r && typeof r === 'object') : [];
  const composite = c && isNum(c.total)
    ? {
        total: { v: `${c.total > 0 ? '+' : ''}${c.total}${isStr(c.tier) ? ` ${c.tier}` : ''}`, p: 'ENGINE' as Provenance },
        rows: (rows.length ? rows : COMPOSITE_FACTORS.map(f => ({ factor: f, value: null, score: null }))).map(r => ({
          factor: isStr(r.factor) ? r.factor : '—',
          value: r.value == null ? '—' : String(r.value),
          score: isNum(r.score) ? `${r.score > 0 ? '+' : ''}${r.score}` : '—',
        })),
        missing: false,
      }
    : { total: MISSING, rows: COMPOSITE_FACTORS.map(f => ({ factor: f, value: '—', score: '—' })), missing: true };

  // Contract
  const c2 = v2?.contract ?? null;
  const contractRows: VMRow[] = [
    { label: 'Symbol', field: field(isStr(trade.contract_symbol) ? trade.contract_symbol : null, 'VERIFIED') },
    { label: 'Strike · expiry', field: field(isNum(trade.strike) ? `$${trade.strike} · ${isStr(trade.expiry) ? trade.expiry : 'expiry —'}` : null, 'VERIFIED') },
    { label: 'Entry fill', field: field(entry != null ? fmtPremium(entry) : null, 'VERIFIED') },
    { label: 'Quote at entry', field: pf(c2?.quote) },
    { label: 'Delta · IV', field: pf(c2?.greeks) },
    { label: 'Volume / OI', field: pf(c2?.vol_oi) },
    { label: 'Buying power', field: pf(c2?.buying_power) },
  ];

  // Frozen config — v2 snapshot first, then the levels every row already stores.
  const fc = v2?.frozen_config ?? null;
  const legacyLevel = (k: 'hard_stop_price' | 'tp1_price' | 'tp2_price') => {
    const x = (trade as unknown as Record<string, unknown>)[k];
    return isNum(x) && x > 0 ? field(fmtPremium(x), 'ENGINE') : MISSING;
  };
  const configRows: VMRow[] = [
    { label: 'Strategy', field: field(isStr(v2?.strategy_name) ? v2!.strategy_name! : (trade.strategy_id ?? null), v2?.strategy_name ? 'ENGINE' : 'VERIFIED') },
    { label: 'Profile · config', field: field(`${trade.profile ?? '—'}${isStr(v2?.config_hash) ? ` · ${v2!.config_hash}` : ''}`, 'ENGINE') },
    { label: 'Qty', field: field(entered != null ? String(entered) : null, 'VERIFIED') },
    { label: 'Hard stop', field: fc?.hard_stop ? pf(fc.hard_stop) : legacyLevel('hard_stop_price') },
    { label: 'TP1', field: fc?.tp1 ? pf(fc.tp1) : legacyLevel('tp1_price') },
    { label: 'TP2', field: fc?.tp2 ? pf(fc.tp2) : legacyLevel('tp2_price') },
    { label: 'TP1 close %', field: pf(fc?.tp1_close_pct) },
    { label: 'TP2 close %', field: pf(fc?.tp2_close_pct) },
    { label: 'Cascade', field: pf(fc?.cascade) },
    { label: 'Runner mode', field: pf(fc?.runner_mode) },
    { label: 'Mid-trade overrides', field: Array.isArray(v2?.overrides)
        ? field(v2!.overrides!.length ? v2!.overrides!.map(o => `${o?.field ?? '?'}: ${String(o?.old ?? '—')} → ${String(o?.new ?? '—')}${o?.who ? ` (${o.who}${o.via ? `, ${o.via}` : ''})` : ''}`).join('; ') : 'none', 'MANUAL')
        : MISSING },
  ];

  // Reconciliation — sum of priced exit legs vs the recorded total.
  let reconciliation: TradeDetailVM['reconciliation'] = null;
  if (exited > 0) {
    const recorded = isNum(trade.pnl) ? trade.pnl : null;
    const priced = exitLegs.filter(l => l.legPnl != null);
    const sum = priced.reduce((s, l) => s + (l.legPnl ?? 0), 0);
    const suspect = exitLegs.filter(l => l.p === 'MISSING' || l.p === 'INFERRED' || l.legPnl == null);
    if (recorded == null) {
      reconciliation = { ok: false, text: `Legs sum to ${fmtMoney(sum)}. Recorded total not logged.`, field: MISSING };
    } else {
      const gap = recorded - sum;
      const ok = Math.abs(gap) < 0.01 && suspect.length === 0;
      const scope = isOpen ? 'realized so far' : 'recorded total';
      reconciliation = ok
        ? { ok, text: `Legs sum to ${fmtMoney(sum)} · ${scope} ${fmtMoney(recorded)} · gap $0.00`, field: { v: '$0.00', p: 'ENGINE' } }
        : {
            ok: false,
            text: `Legs sum to ${fmtMoney(sum)}, ${scope} is ${fmtMoney(recorded)}. Gap ${fmtMoney(gap)}.`,
            field: suspect.length
              ? { v: `Explained by: ${suspect.map(l => l.title).join(', ')}`, p: suspect.some(l => l.p === 'MISSING') ? 'MISSING' : 'INFERRED',
                  basis: 'These legs are inferred or have no fill record, so the gap sits with them.' }
              : { v: 'Unexplained', p: 'MISSING', basis: 'Every leg has a record, yet they do not add up to the total. Check fills against the broker.' },
          };
    }
  }

  // Outcome
  const o2 = v2?.outcome ?? null;
  const bal = isNum(trade.account_balance_before) && isNum(trade.pnl) && !isOpen
    ? field(`$${trade.account_balance_before.toFixed(2)} → $${(trade.account_balance_before + trade.pnl).toFixed(2)}`, 'ENGINE',
        'Balance at entry plus this trade\'s P&L. The account\'s own swing over the same time mixes in other trades.')
    : MISSING;
  const outcomeRows: VMRow[] = [
    { label: 'Max favourable', field: pf(o2?.mfe) },
    { label: 'Max adverse', field: pf(o2?.mae) },
    { label: 'Time to TP1', field: pf(o2?.t_tp1) },
    { label: 'Time to TP2', field: pf(o2?.t_tp2) },
    { label: 'Time to BE', field: pf(o2?.t_be) },
    { label: 'Account, this trade only', field: bal },
  ];

  const pe = v2?.post_exit ?? null;
  const postExit: VMRow[] = isOpen ? [] : [
    { label: '+15 min', field: pf(pe?.p15) },
    { label: '+30 min', field: pf(pe?.p30) },
    { label: 'EOD', field: pf(pe?.eod) },
    { label: 'vs holding to EOD', field: pf(pe?.missed) },
  ];

  const cls = Array.isArray(v2?.classification)
    ? v2!.classification!.filter(q => q && isStr(q.question) && isStr(q.answer)).map(q => ({ question: q.question!, answer: q.answer! }))
    : null;

  // Re-entry: engine-logged linkage wins; else derived from the day's trades.
  const r2 = v2?.reentry;
  const reentry: PField<string> | null = r2 && typeof r2 === 'object' && isStr(r2.prev_trade_id)
    ? {
        v: `Follows trade ${r2.prev_trade_id}, which exited on ${reasonLabel(r2.prev_exit_reason)} at ${fmtEtClock(r2.prev_exit_time) ?? '—'} ET. `
          + `This trade entered ${isNum(r2.minutes_since) ? r2.minutes_since : '?'} min later. `
          + (isNum(r2.cooldown_min) ? `Cooldown (${r2.cooldown_min} min) ${r2.cooldown_ok === true ? 'satisfied' : r2.cooldown_ok === false ? 'NOT satisfied' : 'not logged'}. ` : 'Cooldown not logged. ')
          + (isStr(r2.gate_note) ? r2.gate_note : 'Gate re-check not logged.'),
        p: 'ENGINE',
      }
    : deriveReentry(trade, dayTrades);

  return {
    headline: finalCloseLabel(trade),
    badges,
    pnl,
    pnlValue,
    pnlLabel: isPartial ? 'Realized so far' : isOpen ? 'Unrealized (live)' : 'P&L',
    unrealized,
    qtyText: `${entered ?? '?'} entered · ${exited} exited`,
    timesText: `${entryT ?? '—'} → ${exitT ?? (isOpen ? 'open' : '—')} ET`,
    durationText: tIn && tOut ? fmtSpan(tOut.getTime() - tIn.getTime()) : tIn && isOpen ? `${fmtSpan(Date.now() - tIn.getTime())} so far` : null,
    entryPremium: field(entry != null ? fmtPremium(entry) : null, 'VERIFIED'),
    avgExit: avg != null
      ? { v: fmtPremium(avg), p: 'ENGINE', basis: exited > 1 ? `Entry + recorded P&L across ${exited} contracts.` : null }
      : exited > 0 ? MISSING : { v: '—', p: 'ENGINE', basis: 'Nothing exited yet.' },
    lastLeg: lastLegPrem ? { v: lastLegPrem, p: lastPriced!.p } : exited > 0 ? MISSING : { v: '—', p: 'ENGINE' },
    reentry,
    entry: entryRows,
    composite,
    contract: contractRows,
    config: configRows,
    legs,
    cascadeNote: v2Events ? null : { v: null, p: 'MISSING', basis: 'Cascade candidates and blocks were not logged before v2.' },
    reconciliation,
    outcome: outcomeRows,
    postExit,
    classification: cls,
  };
}
