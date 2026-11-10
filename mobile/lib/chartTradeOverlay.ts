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

import type { LadderRung, LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { DELTA_STALE_S } from '@/lib/exitConversion';

/** TP = any rung of the ladder (engine TP1/TP2 or a chart / Edit line). */
export type OverlayLineKind = 'TP' | 'BE' | 'SL';
export type OverlayLineStyle = 'solid' | 'dashed' | 'dotted';
export type OverlayTone = 'up' | 'down' | 'flat' | 'stale';

export interface OverlayLine {
  /** Stable identity: 'tp1' / 'tp2' / a user line id / 'be' / 'sl'. */
  key: string;
  kind: OverlayLineKind;
  /** TP1, TP2, … (premium order), BE, SL. */
  label: string;
  /** A user (chart / Edit) line — movable and deletable from the chart. */
  user: boolean;
  /** This rung already sold — drawn green with ✓ TP (spec §4.4). */
  hit: boolean;
  /** Can be selected / dragged / edited from the chart. False for a fired
   *  rung (history) and for a BE line that hasn't armed yet (it's defined
   *  as entry; there's no stop there to move). */
  editable: boolean;
  price: number;          // where it sits on the underlying axis
  premium: number | null; // what the engine actually evaluates (null = a
                          // stock-only line — the engine evaluates the stock)
  style: OverlayLineStyle;
  /** Greyed: stale quote or low delta. (A hit rung is green, not grey.) */
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
  /** Compact ladder for the pill — "TP1 768.56 · TP2 769.20 · R1" (§3.4). */
  summary: string | null;
}

export interface TradeOverlayFrame {
  /** Selected trade identity: strategy + contract (a re-entry is a new key). */
  tradeKey: string;
  sim: boolean;
  lines: OverlayLine[];
  /** Why lines are missing or estimated — always said on screen (§3.3).
   *  Null when every line is drawn from a usable delta. */
  linesNote: string | null;
  markers: OverlayMarker[];
  /** Live quote behind the lines (null when delta/underlying/mid is missing) —
   *  lets the chart relabel a line's premium / % while it's being dragged. */
  quote: { stock: number; premium: number; delta: number; entry: number } | null;
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
  delta_source?: string | null;
  delta_age_s?: number | null;
  quote_age_s?: number | null;
  be_stop_active?: boolean | null;
  be_level?: number | null;
  qty_entered?: number | null;
  strategy_name?: string | null;
  tp_ladder?: LadderRung[] | null;
}

export const STALE_AFTER_MS = 10_000;
export const LOW_DELTA = 0.15;
export const REDRAW_EVERY_MS = 300_000; // Kareem 2026-11-02: 5-minute line cadence; badge still redraws immediately on marker change below.
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
  // 2026-11-02 fix: the badge must match the position card below the chart,
  // which shows live.pnl — unrealized PnL on the contracts still open.
  // The old total (realized + unrealized) made the badge read +$444 while
  // the card read +$324 after TP1 banked 2 contracts, and the 15s draw
  // throttle made it read -$18 while the card read -$26. Sim trades have
  // no card, so they keep the total.
  const pnl = sim ? totalPnl(live) : (isNum(live.pnl) ? live.pnl : null);
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
    summary: ladderSummary(live),
  };
}

/** The ladder rungs still to fire, in premium order — from the engine's
 *  tp_ladder, else the classic TP1/TP2 pair (older backend / simulation).
 *  A rung counts if it has a premium OR a stock price — a stock-only line
 *  (no delta, 2026-11-10) has no premium and must still draw. */
function ladderOf(live: OverlayTradeInput['live']): LadderRung[] {
  if (Array.isArray(live.tp_ladder) && live.tp_ladder.length) {
    return live.tp_ladder.filter(r => r && (isNum(r.premium) || isNum(r.stock_price)));
  }
  const out: LadderRung[] = [];
  if (isNum(live.tp1)) out.push({ key: 'tp1', label: 'TP1', source: 'engine', premium: live.tp1, qty: 0, hit: !!live.tp1_hit });
  if (live.use_tp2 !== false && isNum(live.tp2)) {
    out.push({ key: 'tp2', label: 'TP2', source: 'engine', premium: live.tp2, qty: 0, hit: !!live.tp2_hit });
  }
  return out;
}

/** "TP1 768.56 · TP2 769.20 · R1": rungs left to fire (stock price when the
 *  engine could project it, else premium) and the runner count. */
export function ladderSummary(live: OverlayTradeInput['live']): string | null {
  const open = ladderOf(live).filter(r => !r.hit);
  if (!open.length) return null;
  const left = open.map(r => `${r.label} ${isNum(r.stock_price) ? r.stock_price.toFixed(2) : `$${fmtPrem(r.premium ?? 0)}`}`);
  const sold = open.reduce((n, r) => n + (r.qty || 0), 0);
  const runner = Array.isArray(live.tp_ladder) && live.tp_ladder.length ? Math.max(0, live.qty_remaining - sold) : null;
  return [...left, ...(runner != null ? [`R${runner}`] : [])].join(' · ');
}

/** The selected trade's lines, per brief §2 (projection) and §4 (states). */
function linesFor(t: OverlayTradeInput, now: number): {
  lines: OverlayLine[]; note: string | null; sig: string; refPrice: number | null;
  quote: TradeOverlayFrame['quote'];
} {
  const live = t.live;
  const sim = !!live.sim;
  const tp1Hit = !!live.tp1_hit;
  const beArmed = live.be_stop_active ?? (tp1Hit && live.runner_mode !== 'none');
  const entry = live.entry_premium;
  const beLevel = isNum(live.be_level) ? live.be_level : entry;
  const ladder = ladderOf(live);
  const anyTpHit = ladder.some(r => r.hit);

  type Want = { key: string; kind: OverlayLineKind; label: string; premium: number | null;
                stockPrice?: number | null; style: OverlayLineStyle;
                hit?: boolean; pending?: boolean; user?: boolean };
  const want: Want[] = [];
  // TP rungs: the highest-premium one solid, the rest dashed (§3.3) — two
  // rungs keep today's TP2-solid / TP1-dashed look. A stock-only rung has no
  // premium, so it never tops the max and draws dashed.
  const top = ladder.reduce((m, r) => Math.max(m, r.premium ?? -Infinity), -Infinity);
  for (const r of ladder) {
    want.push({ key: r.key, kind: 'TP', label: r.label, premium: r.premium,
                stockPrice: r.stock_price ?? null,
                style: r.premium != null && r.premium === top ? 'solid' : 'dashed',
                hit: r.hit, user: r.source !== 'engine' });
  }
  if (beArmed) {
    want.push({ key: 'be', kind: 'BE', label: 'BE', premium: isNum(live.hard_stop) ? live.hard_stop : beLevel, style: 'solid' });
  } else {
    if (!anyTpHit && isNum(beLevel)) want.push({ key: 'be', kind: 'BE', label: 'BE', premium: beLevel, style: 'dashed', pending: true });
    if (isNum(live.hard_stop) && live.hard_stop > 0 && live.sl_enabled !== false) {
      want.push({ key: 'sl', kind: 'SL', label: 'SL', premium: live.hard_stop, style: 'dotted' });
    }
  }

  const stale = !sim && quoteAgeMs(t, now) > STALE_AFTER_MS;
  const deltaRaw = isNum(live.delta) && live.delta !== 0 ? live.delta : null;
  const deltaAge = isNum(live.delta_age_s) ? live.delta_age_s : null;
  const deltaStale = deltaRaw != null && deltaAge != null && deltaAge > DELTA_STALE_S;
  const delta = deltaStale ? null : deltaRaw;
  const u = isNum(live.underlying_price) ? live.underlying_price : null;
  const cur = isNum(live.mid_price) ? live.mid_price : null;
  const lowDelta = !sim && delta != null && Math.abs(delta) < LOW_DELTA;

  const positionOf = (w: Want): number | null => {
    // A stock-only line is placed at its stored stock price — no delta,
    // no live premium, no projection. It draws even when the feed has
    // no Greeks (2026-11-10).
    if (isNum(w.stockPrice) && w.premium == null) return w.stockPrice;
    if (sim) {
      if (w.key === 'tp1') return live.tp1_underlying ?? null;
      if (w.key === 'tp2') return live.tp2_underlying ?? null;
      if (w.kind === 'BE') return w.pending ? live.entry_underlying ?? null : live.stop_underlying ?? null;
      if (w.kind === 'SL') return live.stop_underlying ?? null;
      return null;
    }
    if (delta == null || u == null || cur == null || w.premium == null) return null;
    return u + (w.premium - cur) / delta;
  };

  // Every line that can't be placed is explained once, on screen (§3.3).
  // A stock-only line draws with no delta at all — when one exists, the
  // "unavailable" note is about the premium lines, not every line.
  let note: string | null = null;
  if (!sim) {
    const src = live.delta_source ? `source ${live.delta_source}` : 'no source';
    const age = deltaAge != null ? ` · ${deltaAge < 60 ? `${Math.round(deltaAge)}s` : `${Math.round(deltaAge / 60)}m`} old` : '';
    const stockOnlyLine = ladder.some(r => !r.hit && isNum(r.stock_price) && r.premium == null);
    const unavailable = stockOnlyLine ? 'Premium lines unavailable' : 'Lines unavailable';
    if (deltaRaw == null) note = `${unavailable} — no delta (${src})`;
    else if (deltaStale) note = `${unavailable} — delta stale (${src}${age})`;
    else if (u == null) note = `${unavailable} — no underlying price yet`;
    else if (cur == null) note = `${unavailable} — no live premium`;
    else if (lowDelta && want.some(w => w.premium != null)) note = `Lines are estimates — low delta Δ ${Math.abs(delta!).toFixed(2)}`;
  }

  const lines: OverlayLine[] = [];
  for (const w of want) {
    const price = positionOf(w);
    if (!isNum(price)) continue;      // explained by `note` above
    // A stock-only line sits at an exact stock price — no delta estimate,
    // so no ≈ suffix and the title shows the stock price, not a premium.
    const placedByStock = isNum(w.stockPrice) && w.premium == null;
    const titlePrice = placedByStock ? w.stockPrice! : (w.premium ?? 0);
    const suffix = (w.hit ? '' : w.pending ? ' · arms after first TP' : '') + (lowDelta && !placedByStock ? ' · ≈' : '');
    lines.push({
      key: w.key,
      kind: w.kind,
      label: w.label,
      user: !!w.user,
      hit: !!w.hit,
      editable: !w.hit && !w.pending && !sim,
      price: Math.round(price * 100) / 100,
      premium: w.premium,
      style: w.style,
      muted: stale || (lowDelta && !placedByStock),
      title: `${sim ? 'SIM ' : ''}${w.hit ? '✓ ' : ''}${w.label} · $${fmtPrem(titlePrice)}${suffix}`,
    });
  }
  const sig = [
    live.qty_remaining, tp1Hit, !!live.tp2_hit, beArmed, stale, lowDelta, note ?? '',
    ladder.map(r => `${r.key}:${r.premium}:${r.stock_price ?? ''}:${r.qty}:${r.hit}`).join(','),
    live.runner_mode ?? '', live.sl_enabled ?? '', live.hard_stop ?? '',
  ].join('|');
  const quote = !sim && delta != null && u != null && cur != null ? { stock: u, premium: cur, delta, entry } : null;
  return { lines, note, sig, refPrice: u, quote };
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
  const { lines, note, sig, refPrice, quote } = linesFor(sel, now);
  // Selected marker first: it sits on the current price, others stack above.
  const markers = [sel, ...open.filter(t => t !== sel)].map(t => marker(t, now, t === sel, multi));
  const tradeKey = `${sel.strategyId}:${sel.live.contract}`;
  return {
    tradeKey,
    sim: !!sel.live.sim,
    lines,
    linesNote: note,
    markers,
    quote,
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
 *  - 5 minutes passed since the last draw (Kareem 2026-11-02),
 *  - or any line moved ≥ moveThreshold from where it was drawn.
 */
export function shouldRedraw(prev: DrawnFrame | null, next: TradeOverlayFrame | null, now: number): boolean {
  if (!prev) return next != null;
  const p = prev.frame;
  if (!p || !next) return p !== next;
  if (p.stateSig !== next.stateSig) return true;
  if (next.sim) return next.simTick !== p.simTick;
  // 2026-11-02 fix: the badge is the user's live PnL readout, so a marker
  // change (PnL text or contracts remaining) redraws immediately instead
  // of waiting out the line cadence — that throttle is what left the
  // badge $8 behind the position card on a fast 0DTE. Redrawing the
  // overlay layer only re-applies price lines in-page; it never re-renders
  // candles, EMAs or VWAP.
  if (next.markers.some(m => {
    const drawn = p.markers.find(d => d.key === m.key);
    return !drawn || drawn.pnlText !== m.pnlText || drawn.count !== m.count || drawn.summary !== m.summary;
  })) return true;
  if (now - prev.at >= REDRAW_EVERY_MS) return true;
  const th = moveThreshold(next.refPrice, next.ticker);
  return next.lines.some(l => {
    const drawn = p.lines.find(d => d.key === l.key);
    return !drawn || Math.abs(drawn.price - l.price) >= th;
  });
}
