// Chart trade overlay (Chart Trade Overlay brief v2) — pure logic, no React.
//
// Turns the live position push (`price_update` on /ws/strategy/<id>/live —
// the same payload the position cards read) into what the main chart draws:
// TP2 / TP1 / BE / SL price lines, each labelled with its PREMIUM (the axis
// label carries the price), plus a compact marker on the current price with
// contracts remaining and the trade's total P&L.
//
// DISPLAY ONLY: nothing here feeds an exit decision. Premium levels come
// from the engine; this only projects them onto the underlying's axis:
//   price_line = underlying + (target_premium − current_premium) / delta
// A PUT's negative delta handles direction on its own. Simulation payloads
// carry pre-mapped *_underlying positions instead (no delta in a sim).

import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';

export type OverlayLineKind = 'TP2' | 'TP1' | 'BE' | 'SL';
export type OverlayLineStyle = 'solid' | 'dashed' | 'dotted';
export type OverlayTone = 'up' | 'down' | 'flat' | 'stale';

export interface OverlayLine {
  kind: OverlayLineKind;
  price: number;          // where it sits on the underlying axis
  premium: number;        // what the engine actually evaluates
  style: OverlayLineStyle;
  /** Greyed: stale quote, low delta, or a level already hit (history). */
  muted: boolean;
  /** Text drawn on the line beside its axis label (which shows `price`). */
  title: string;
}

export interface OverlayMarker {
  key: string;
  /** Strategy short name — only when more than one trade is on this ticker. */
  label: string | null;
  /** Contracts remaining, or "R" for the last runner. */
  count: string;
  pnlText: string;
  tone: OverlayTone;
  runner: boolean;
  selected: boolean;
  sim: boolean;
  stale: boolean;
}

export interface TradeOverlayFrame {
  /** Selected trade identity: strategy + contract (a re-entry is a new key). */
  tradeKey: string;
  sim: boolean;
  lines: OverlayLine[];
  markers: OverlayMarker[];
  /** Changes on any state transition → redraw immediately (see shouldRedraw). */
  stateSig: string;
  /** For the "line moved ≥ threshold" check. */
  refPrice: number | null;
  ticker: string | null;
  simTick: number | null;
}

export interface OverlayTradeInput {
  strategyId: string;
  /** Strategy display name (e.g. "SPY Rider"). */
  name: string | null;
  live: LivePriceData & OverlayLiveExtras;
  /** Date.now() when this payload arrived. */
  receivedAt: number;
}

/** Fields the engine adds to price_update for the overlay (absent on an
 *  older backend — every one is optional and handled as missing). */
export interface OverlayLiveExtras {
  realized_pnl?: number | null;
  delta?: number | null;
  delta_age_s?: number | null;
  quote_age_s?: number | null;
  be_stop_active?: boolean | null;
  be_level?: number | null;
  qty_entered?: number | null;
  strategy_name?: string | null;
}

export const STALE_AFTER_MS = 10_000;
export const LOW_DELTA = 0.15;
export const REDRAW_EVERY_MS = 15_000;
export const REDRAW_MAX_MS = 30_000;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const fmtPrem = (n: number) => (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 ? n.toFixed(3) : n.toFixed(2));

/** "≥ $0.10 for SPY/QQQ; max($0.10, 0.05% of price) for other tickers." */
export function moveThreshold(price: number | null, ticker?: string | null): number {
  if (ticker === 'SPY' || ticker === 'QQQ' || !isNum(price)) return 0.1;
  return Math.max(0.1, price * 0.0005);
}

/** Underlying root of an OCC option symbol ("SPY261030P00758000" → "SPY"). */
const occRoot = (contract: string | null | undefined) => contract?.match(/^[A-Z]+/)?.[0] ?? null;

function shortName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.trim().toUpperCase();
  return s.length > 12 ? s.slice(0, 12) : s;
}

/** Quote age at `now`: what the engine reported at send time + transit/hold. */
function quoteAgeMs(t: OverlayTradeInput, now: number): number {
  const reported = isNum(t.live.quote_age_s) ? t.live.quote_age_s * 1000 : 0;
  return reported + Math.max(0, now - t.receivedAt);
}

export function totalPnl(live: OverlayTradeInput['live']): number | null {
  const unreal = isNum(live.pnl) ? live.pnl : null;
  if (unreal == null) return null;
  if (isNum(live.realized_pnl)) return live.realized_pnl + unreal;
  // Older backend without realized_pnl: only exact while nothing has exited.
  const entered = isNum(live.qty_entered) ? live.qty_entered : null;
  const exited = live.tp1_hit || (entered != null && live.qty_remaining < entered);
  return exited ? null : unreal;
}

function marker(t: OverlayTradeInput, now: number, selected: boolean, multi: boolean): OverlayMarker {
  const live = t.live;
  const sim = !!live.sim;
  const stale = !sim && quoteAgeMs(t, now) > STALE_AFTER_MS;
  const pnl = totalPnl(live);
  const runner = live.qty_remaining === 1;
  const sign = pnl == null ? '' : pnl > 0.004 ? '+' : pnl < -0.004 ? '−' : '';
  return {
    key: t.strategyId,
    label: multi ? shortName(live.strategy_name ?? t.name) : null,
    count: runner ? 'R' : String(live.qty_remaining),
    pnlText: pnl == null ? '—' : `${sign}${Math.abs(pnl).toFixed(2)}`,
    tone: stale || pnl == null ? 'stale' : pnl > 0.004 ? 'up' : pnl < -0.004 ? 'down' : 'flat',
    runner,
    selected,
    sim,
    stale,
  };
}

/** The selected trade's lines, per brief §2 (projection) and §4 (states). */
function linesFor(t: OverlayTradeInput, now: number): { lines: OverlayLine[]; sig: string; refPrice: number | null } {
  const live = t.live;
  const sim = !!live.sim;
  const tp1Hit = !!live.tp1_hit;
  const tp2Hit = !!live.tp2_hit;
  // BE is armed once the engine moved the stop to breakeven (normally at
  // TP1). runner_mode "none" leaves the original stop in place — then the
  // SL is still the live stop and there is no BE line to arm.
  const beArmed = live.be_stop_active ?? (tp1Hit && live.runner_mode !== 'none');
  const useTp2 = live.use_tp2 !== false;
  const entry = live.entry_premium;
  const beLevel = isNum(live.be_level) ? live.be_level : entry;

  const want: { kind: OverlayLineKind; premium: number; style: OverlayLineStyle; hit?: boolean; pending?: boolean }[] = [];
  if (useTp2 && isNum(live.tp2)) want.push({ kind: 'TP2', premium: live.tp2, style: 'solid', hit: tp2Hit });
  if (isNum(live.tp1)) want.push({ kind: 'TP1', premium: live.tp1, style: 'dashed', hit: tp1Hit });
  if (beArmed) {
    want.push({ kind: 'BE', premium: isNum(live.hard_stop) ? live.hard_stop : beLevel, style: 'solid' });
  } else {
    if (!tp1Hit && isNum(beLevel)) want.push({ kind: 'BE', premium: beLevel, style: 'dashed', pending: true });
    if (isNum(live.hard_stop) && live.hard_stop > 0 && live.sl_enabled !== false) {
      want.push({ kind: 'SL', premium: live.hard_stop, style: 'dotted' });
    }
  }

  const stale = !sim && quoteAgeMs(t, now) > STALE_AFTER_MS;
  const delta = isNum(live.delta) && live.delta !== 0 ? live.delta : null;
  const u = isNum(live.underlying_price) ? live.underlying_price : null;
  const cur = isNum(live.mid_price) ? live.mid_price : null;
  const lowDelta = !sim && delta != null && Math.abs(delta) < LOW_DELTA;

  const positionOf = (kind: OverlayLineKind, premium: number, pending?: boolean): number | null => {
    if (sim) {
      // Sim: the payload's own premium→underlying mapping. Before TP1 the
      // stop is the SL and BE (pending) sits at entry; after TP1 the sim's
      // stop_underlying IS the breakeven line.
      if (kind === 'TP1') return live.tp1_underlying ?? null;
      if (kind === 'TP2') return live.tp2_underlying ?? null;
      if (kind === 'BE') return pending ? live.entry_underlying ?? null : live.stop_underlying ?? null;
      return live.stop_underlying ?? null;
    }
    if (delta == null || u == null || cur == null) return null;
    return u + (premium - cur) / delta;
  };

  const lines: OverlayLine[] = [];
  for (const w of want) {
    const price = positionOf(w.kind, w.premium, w.pending);
    if (!isNum(price)) continue;
    const suffix = (w.hit ? ' · hit' : w.pending ? ' · arms after TP1' : '') + (lowDelta ? ' · ESTIMATE, low delta' : '');
    lines.push({
      kind: w.kind,
      price: Math.round(price * 100) / 100,
      premium: w.premium,
      style: w.style,
      muted: !!w.hit || stale || lowDelta,
      title: `${sim ? 'SIM ' : ''}${w.kind} · $${fmtPrem(w.premium)}${suffix}`,
    });
  }
  const linesAvailable = sim || (delta != null && u != null && cur != null);
  const sig = [
    live.qty_remaining, tp1Hit, tp2Hit, beArmed, useTp2, stale, lowDelta, linesAvailable,
    live.runner_mode ?? '', live.sl_enabled ?? '',
  ].join('|');
  return { lines, sig, refPrice: u };
}

/**
 * Overlay for one ticker. `trades` are every open position on the ticker on
 * screen; lines are drawn for the selected one only, markers for all (stacked,
 * one per strategy — never merged). Returns null when nothing is open.
 */
export function buildOverlayFrame(
  trades: OverlayTradeInput[],
  selectedKey: string | null,
  now: number,
): TradeOverlayFrame | null {
  const open = trades.filter(t => t.live && isNum(t.live.qty_remaining) && t.live.qty_remaining > 0);
  if (!open.length) return null;
  const sel = open.find(t => t.strategyId === selectedKey) ?? open[open.length - 1];
  const multi = open.length > 1;
  const { lines, sig, refPrice } = linesFor(sel, now);
  // Selected marker first: it sits on the current price, others stack above.
  const markers = [sel, ...open.filter(t => t !== sel)].map(t => marker(t, now, t === sel, multi));
  const tradeKey = `${sel.strategyId}:${sel.live.contract}`;
  return {
    tradeKey,
    sim: !!sel.live.sim,
    lines,
    markers,
    stateSig: `${tradeKey}|${sig}|${markers.map(m => `${m.key}:${m.count}:${m.stale}`).join(',')}`,
    refPrice,
    ticker: occRoot(sel.live.contract),
    simTick: isNum(sel.live.sim_tick) ? sel.live.sim_tick : null,
  };
}

export interface DrawnFrame { frame: TradeOverlayFrame | null; at: number }

/**
 * Brief §6 cadence: compute on every push, REDRAW only when
 *  - a state changed (TP1/TP2/BE/cascade/qty/stale/close, or a new trade),
 *  - a sim tick arrived (sim draws every 6s tick, §9.3),
 *  - 15s passed since the last draw (30s is the hard cap — implied),
 *  - or any line moved ≥ moveThreshold from where it was drawn.
 */
export function shouldRedraw(prev: DrawnFrame | null, next: TradeOverlayFrame | null, now: number): boolean {
  if (!prev) return next != null;
  const p = prev.frame;
  if (!p || !next) return p !== next;
  if (p.stateSig !== next.stateSig) return true;
  if (next.sim) return next.simTick !== p.simTick;
  if (now - prev.at >= REDRAW_EVERY_MS) return true;
  const th = moveThreshold(next.refPrice, next.ticker);
  return next.lines.some(l => {
    const drawn = p.lines.find(d => d.kind === l.kind);
    return !drawn || Math.abs(drawn.price - l.price) >= th;
  });
}
