import { useMemo, useSyncExternalStore } from 'react';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import type { LimitOrdersResponse, WorkingLimitOrder } from '@/common/types/strategy';

/**
 * Dev-only simulated open positions (Profile → Developer → Simulated
 * Position). Entirely client-side: the price is a random walk ticking every
 * second, and every action a real position supports — manual sell, exit
 * edits, the limit sell ladder — is answered here, never by the backend.
 *
 * Hooked in at the data layer (useLivePositionsData, useStrategyLivePrice,
 * useSellPosition, useUpdateStrategyExits, useLimitOrders), so the REAL
 * position cards, exit editor and limit-sell sheet render a sim position
 * exactly as they would a live one. Ids start with `sim-` (isSimId) — that's
 * the single switch every hook checks. In-memory only: an app restart
 * clears them.
 *
 * Exit rules are a simplified mirror of the backend's: a stop sells the
 * whole position (cancelling the ladder first), TP1/TP2 only sell contracts
 * not resting in limit sells, and a working limit sell fills once the bid
 * reaches it.
 */

export const SIM_PREFIX = 'sim-';
export const isSimId = (id?: string | null): boolean => !!id && id.startsWith(SIM_PREFIX);

export type SimVolatility = 'calm' | 'normal' | 'wild';
const VOL_SIGMA: Record<SimVolatility, number> = { calm: 0.008, normal: 0.02, wild: 0.045 };
const TICK_MS = 1_000;
const SPREAD_PCT = 0.04;

const BASE_PRICES: Record<string, number> = {
  SPY: 580, QQQ: 500, IWM: 220, AAPL: 230, TSLA: 250, NVDA: 130, AMZN: 190, META: 590,
};
export const SIM_TICKERS = Object.keys(BASE_PRICES);

interface SimPosition {
  id: string;
  ticker: string;
  direction: 'CALL' | 'PUT';
  contract: string;
  paper: boolean;
  qtyTotal: number;
  qtyRemaining: number;
  entry: number;
  mid: number;
  sigma: number;
  hardStop: number;
  tp1: number;
  tp2: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  beStop: boolean;
  slEnabled: boolean;
  tpEnabled: boolean;
  useTp2: boolean;
  runnerMode: 'trail' | 'be_hold' | 'none';
  cascadeEnabled: boolean;
  slGraceMinutes: number | null;
  slOuterFloor: number | null;
  slFloorEnabled: boolean;
  beGraceSeconds: number;
  orders: WorkingLimitOrder[];
  realizedPnl: number;
}

export interface SimLogEntry { t: number; text: string }

let positions: SimPosition[] = [];
let log: SimLogEntry[] = [];
let seq = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let snapshot: { positions: SimPosition[]; log: SimLogEntry[] } = { positions: [], log: [] };
const listeners = new Set<() => void>();

const r2 = (n: number) => Math.round(n * 100) / 100;
const bidOf = (p: SimPosition) => r2(Math.max(0.01, p.mid * (1 - SPREAD_PCT / 2)));
const askOf = (p: SimPosition) => r2(p.mid * (1 + SPREAD_PCT / 2));
const working = (o: WorkingLimitOrder) => o.status === 'working' || o.status === 'partially_filled';
const reserved = (p: SimPosition) =>
  p.orders.filter(working).reduce((n, o) => n + (o.qty - o.filled_qty), 0);

function emit() {
  snapshot = {
    positions: positions.map((p) => ({ ...p, orders: p.orders.map((o) => ({ ...o })) })),
    log: [...log],
  };
  listeners.forEach((l) => l());
}

function note(p: SimPosition | null, text: string) {
  log = [{ t: Date.now(), text: p ? `${p.ticker} ${p.direction}: ${text}` : text }, ...log].slice(0, 30);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function occSymbol(ticker: string, direction: 'CALL' | 'PUT', strike: number): string {
  const d = new Date();
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${ticker}${yymmdd}${direction === 'CALL' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

// ── Selling (shared by every exit path) ─────────────────────────────────────

/** Sell `qty` at `price`; closes the position when nothing is left. */
function sellQty(p: SimPosition, qty: number, price: number, reason: string) {
  if (qty <= 0) return;
  const pnl = (price - p.entry) * qty * 100;
  p.realizedPnl += pnl;
  p.qtyRemaining -= qty;
  note(p, `${reason} — sold ${qty} @ $${price.toFixed(2)} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`);
  // A profitable partial exit arms breakeven on the rest, like the backend.
  if (p.qtyRemaining > 0 && price > p.entry && p.hardStop < p.entry) {
    p.hardStop = r2(p.entry);
    p.beStop = true;
  }
}

function cancelAllOrders(p: SimPosition) {
  for (const o of p.orders) if (working(o)) o.status = 'canceled';
}

function removeClosed() {
  const before = positions.length;
  positions = positions.filter((p) => {
    if (p.qtyRemaining > 0) return true;
    note(p, `position closed — realized ${p.realizedPnl >= 0 ? '+' : ''}$${p.realizedPnl.toFixed(2)}`);
    return false;
  });
  if (positions.length !== before && positions.length === 0) stopTicking();
}

// ── Price loop ──────────────────────────────────────────────────────────────

function tickOne(p: SimPosition) {
  p.mid = r2(Math.max(0.02, p.mid * Math.exp(gaussian() * p.sigma)));
  const bid = bidOf(p);

  // Resting limit sells fill once the bid reaches them (sometimes partially).
  for (const o of p.orders) {
    if (!working(o) || bid < o.limit_price) continue;
    const left = o.qty - o.filled_qty;
    const fill = left > 1 && Math.random() < 0.3 ? 1 : left;
    const prevNotional = (o.filled_avg_price ?? 0) * o.filled_qty;
    o.filled_qty += fill;
    o.filled_avg_price = r2((prevNotional + o.limit_price * fill) / o.filled_qty);
    o.status = o.filled_qty >= o.qty ? 'filled' : 'partially_filled';
    sellQty(p, fill, o.limit_price, `limit sell filled ${o.filled_qty}/${o.qty}`);
  }
  if (p.qtyRemaining <= 0) return;

  // Protective stop: protects the WHOLE position — cancel the ladder, sell all.
  const floorHit = p.slFloorEnabled && p.slOuterFloor != null && p.mid <= p.slOuterFloor;
  if ((p.slEnabled && p.mid <= p.hardStop) || floorHit) {
    if (p.orders.some(working)) note(p, 'stop cancels the limit sells');
    cancelAllOrders(p);
    sellQty(p, p.qtyRemaining, bid, p.beStop ? 'breakeven stop' : floorHit ? 'floor stop' : 'hard stop');
    return;
  }

  // TPs only sell contracts that aren't resting in limit sells.
  if (p.tpEnabled) {
    const free = p.qtyRemaining - reserved(p);
    if (!p.tp1Hit && p.mid >= p.tp1) {
      p.tp1Hit = true;
      const want = p.qtyRemaining > 1 ? Math.max(1, Math.floor(p.qtyTotal / 3)) : 1;
      if (free > 0) sellQty(p, Math.min(want, free), bid, 'TP1');
      else note(p, 'TP1 reached — all contracts resting in limit sells, nothing sold');
    } else if (p.useTp2 && p.tp1Hit && !p.tp2Hit && p.mid >= p.tp2) {
      p.tp2Hit = true;
      const want = Math.max(1, Math.floor(p.qtyRemaining / 2));
      if (free > 0) sellQty(p, Math.min(want, free), bid, 'TP2');
      else note(p, 'TP2 reached — all contracts resting in limit sells, nothing sold');
    }
  }
}

function tickAll() {
  positions.forEach(tickOne);
  removeClosed();
  emit();
}

function startTicking() {
  if (!timer) timer = setInterval(tickAll, TICK_MS);
}

function stopTicking() {
  if (timer) { clearInterval(timer); timer = null; }
}

// ── Public: lifecycle ───────────────────────────────────────────────────────

export function createSimPosition(opts: {
  contracts: number;
  ticker?: string;
  direction?: 'CALL' | 'PUT';
  paper?: boolean;
  volatility?: SimVolatility;
}): string {
  const ticker = opts.ticker ?? SIM_TICKERS[Math.floor(Math.random() * SIM_TICKERS.length)];
  const direction = opts.direction ?? (Math.random() < 0.5 ? 'CALL' : 'PUT');
  const base = BASE_PRICES[ticker] ?? 100;
  const step = base > 300 ? 5 : base > 100 ? 2.5 : 1;
  const strike = Math.round((base + (direction === 'CALL' ? step : -step)) / step) * step;
  const entry = r2(0.6 + Math.random() * 1.9);
  const qty = Math.max(1, Math.min(50, Math.round(opts.contracts)));
  const id = `${SIM_PREFIX}${Date.now().toString(36)}-${++seq}`;
  const p: SimPosition = {
    id, ticker, direction, contract: occSymbol(ticker, direction, strike),
    paper: opts.paper ?? true, qtyTotal: qty, qtyRemaining: qty, entry, mid: entry,
    sigma: VOL_SIGMA[opts.volatility ?? 'normal'],
    hardStop: r2(entry * 0.7), tp1: r2(entry * 1.3), tp2: r2(entry * 1.6),
    tp1Hit: false, tp2Hit: false, beStop: false, slEnabled: true, tpEnabled: true,
    useTp2: qty > 2, runnerMode: 'trail', cascadeEnabled: true,
    slGraceMinutes: null, slOuterFloor: null, slFloorEnabled: false, beGraceSeconds: 0,
    orders: [], realizedPnl: 0,
  };
  positions = [...positions, p];
  note(p, `opened ${qty} × ${p.contract} @ $${entry.toFixed(2)}`);
  startTicking();
  emit();
  return id;
}

export function removeSimPosition(id: string) {
  const p = positions.find((x) => x.id === id);
  if (p) note(p, 'removed');
  positions = positions.filter((x) => x.id !== id);
  if (!positions.length) stopTicking();
  emit();
}

export function clearSimPositions() {
  positions = [];
  stopTicking();
  note(null, 'all simulated positions cleared');
  emit();
}

// ── Public: actions (what the backend would do for a real position) ─────────

const find = (id: string) => {
  const p = positions.find((x) => x.id === id);
  if (!p) throw new Error('Simulated position is closed');
  return p;
};

export async function simSell(id: string, qty?: number, limitPrice?: number) {
  await new Promise((r) => setTimeout(r, 900));     // feel like a real round trip
  const p = find(id);
  const free = p.qtyRemaining - reserved(p);
  if (free <= 0) throw new Error('All contracts have resting limit sells — cancel one to sell now');
  const n = Math.max(1, Math.min(qty ?? free, free));
  const bid = bidOf(p);
  // Every manual sell ends at the bid in the sim: a limit at/below the bid
  // fills there, and above it the real priced exit falls back to market
  // after 10s. `limitPrice` only shows up in the log.
  const price = bid;
  if (limitPrice != null) note(p, `manual sell limit $${limitPrice.toFixed(2)} → filled at bid`);
  const fullyClosed = n >= p.qtyRemaining;
  sellQty(p, n, price, 'manual sell');
  const pnl = (price - p.entry) * n * 100;
  const remaining = p.qtyRemaining;
  removeClosed();
  emit();
  return {
    status: 'ok' as const,
    message: `Sold ${n} contract(s) of ${p.contract} @ $${price.toFixed(2)} (simulated)`,
    qty_sold: n, qty_remaining: fullyClosed ? 0 : remaining,
    avg_fill_price: price, pnl: Math.round(pnl * 100) / 100,
  };
}

export function simUpdateExits(id: string, patch: Record<string, unknown>) {
  const p = find(id);
  const num = (k: string) => (typeof patch[k] === 'number' ? (patch[k] as number) : undefined);
  if (num('hard_stop') != null) p.hardStop = r2(num('hard_stop')!);
  if (num('tp1') != null) p.tp1 = r2(num('tp1')!);
  if (num('tp2') != null) p.tp2 = r2(num('tp2')!);
  if (typeof patch.sl_enabled === 'boolean') p.slEnabled = patch.sl_enabled;
  if (typeof patch.tp_enabled === 'boolean') p.tpEnabled = patch.tp_enabled;
  if (typeof patch.cascade_enabled === 'boolean') p.cascadeEnabled = patch.cascade_enabled;
  if (patch.runner_mode) p.runnerMode = patch.runner_mode as SimPosition['runnerMode'];
  if ('sl_grace_minutes' in patch) p.slGraceMinutes = (patch.sl_grace_minutes as number | null) ?? null;
  if (num('sl_outer_floor') != null) { p.slOuterFloor = r2(num('sl_outer_floor')!); p.slFloorEnabled = true; }
  if (typeof patch.sl_floor_enabled === 'boolean') p.slFloorEnabled = patch.sl_floor_enabled;
  if (num('be_grace_seconds') != null) p.beGraceSeconds = num('be_grace_seconds')!;
  note(p, `exits edited (${Object.keys(patch).join(', ')})`);
  emit();
  return { status: 'ok', updated: patch, exit_state: toLive(p) };
}

export function simPlaceLimitOrders(id: string, orders: { qty: number; limit_price: number }[]) {
  const p = find(id);
  if (!orders.length) throw new Error('At least one order is required');
  for (const o of orders) {
    if (!Number.isInteger(o.qty) || o.qty < 1 || !(o.limit_price > 0)) {
      throw new Error('qty must be ≥ 1 and limit_price > 0');
    }
  }
  const total = orders.reduce((n, o) => n + o.qty, 0);
  const free = p.qtyRemaining - reserved(p);
  if (total > free) throw new Error(`Only ${free} contract(s) available — ${total} requested`);
  const placed = orders.map((o) => {
    const rec: WorkingLimitOrder = {
      order_id: `sim-ord-${++seq}`, qty: o.qty, limit_price: r2(o.limit_price),
      filled_qty: 0, filled_avg_price: null, status: 'working',
      placed_at: new Date().toISOString(), contract_symbol: p.contract,
    };
    p.orders.push(rec);
    return rec;
  });
  note(p, `limit sells placed — ${placed.map((o) => `${o.qty} @ $${o.limit_price.toFixed(2)}`).join(', ')}`);
  emit();
  return { status: 'accepted' as const, orders: placed, errors: [] };
}

export function simCancelLimitOrder(id: string, orderId: string) {
  const p = find(id);
  const o = p.orders.find((x) => x.order_id === orderId);
  if (!o) throw new Error('Unknown order');
  if (working(o)) {
    o.status = 'canceled';
    note(p, `limit sell ${o.qty} @ $${o.limit_price.toFixed(2)} canceled (${o.filled_qty} filled)`);
  }
  emit();
  return { status: 'ok', order: { ...o } };
}

// ── Mapping to the app's real shapes ────────────────────────────────────────

function toLive(p: SimPosition): LivePriceData {
  const pnl = (p.mid - p.entry) * p.qtyRemaining * 100;
  const res = reserved(p);
  return {
    contract: p.contract, mid_price: p.mid, entry_premium: p.entry,
    pnl: r2(pnl), pnl_pct: r2(((p.mid - p.entry) / p.entry) * 100),
    qty_remaining: p.qtyRemaining, market_value: r2(p.mid * p.qtyRemaining * 100),
    tp1_hit: p.tp1Hit, tp2_hit: p.tp2Hit, hard_stop: p.hardStop, tp1: p.tp1, tp2: p.tp2,
    use_tp2: p.useTp2, sl_grace_enabled: p.slGraceMinutes != null, sl_grace_minutes: p.slGraceMinutes,
    sl_enabled: p.slEnabled, tp_enabled: p.tpEnabled, sl_outer_floor: p.slOuterFloor,
    sl_floor_enabled: p.slFloorEnabled, be_grace_seconds: p.beGraceSeconds, be_grace_active: false,
    runner_mode: p.runnerMode, cascade_enabled: p.cascadeEnabled,
    bid: bidOf(p), ask: askOf(p), qty_working: res, qty_available: p.qtyRemaining - res,
  };
}

function toEntry(p: SimPosition): PositionEntry {
  const live = toLive(p);
  return {
    strategy_id: p.id, strategy_name: 'Simulated', active: true, paper_mode: p.paper,
    ticker: p.ticker, profile: 'CUSTOM', direction: p.direction, contract: p.contract,
    qty_remaining: p.qtyRemaining, qty_total: p.qtyTotal, entry_premium: p.entry,
    current_price: p.mid, unrealized_pnl: live.pnl, unrealized_pnl_pct: live.pnl_pct,
    hard_stop: p.hardStop, tp1: p.tp1, tp2: p.tp2, tp1_hit: p.tp1Hit, tp2_hit: p.tp2Hit,
    be_stop_active: p.beStop, runner_mode: p.runnerMode, use_tp2: p.useTp2,
    sl_grace_enabled: live.sl_grace_enabled, sl_grace_minutes: p.slGraceMinutes,
    sl_enabled: p.slEnabled, tp_enabled: p.tpEnabled, sl_outer_floor: p.slOuterFloor,
    sl_floor_enabled: p.slFloorEnabled, be_grace_seconds: p.beGraceSeconds,
    cascade_enabled: p.cascadeEnabled, qty_working: live.qty_working, qty_available: live.qty_available,
  };
}

function toOrders(p: SimPosition): LimitOrdersResponse {
  const res = reserved(p);
  const sorted = [...p.orders].sort((a, b) =>
    Number(!working(a)) - Number(!working(b)) || a.placed_at.localeCompare(b.placed_at));
  return {
    orders: sorted, qty_held: p.qtyRemaining, qty_working: res,
    qty_available: p.qtyRemaining - res, contract: p.contract,
  };
}

// ── Hooks ───────────────────────────────────────────────────────────────────

const getSnapshot = () => snapshot;

// Every hook below derives its value with useMemo keyed on the store
// snapshot, so it returns the SAME object until the simulator actually
// changes (a tick / an action) — like a socket message. Building a fresh
// object per render made consumers' "report live data up" effects
// (PositionBriefCard → setLiveByStrategy) loop forever: "Maximum update
// depth exceeded" (2026-10-12).

/** Every open sim position, in the app's PositionEntry shape. */
export function useSimPositionEntries(): PositionEntry[] {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => s.positions.map(toEntry), [s]);
}

/** Live tick data for one sim position (null for a real id / closed sim). */
export function useSimLive(id: string | undefined): LivePriceData | null {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => {
    if (!isSimId(id)) return null;
    const p = s.positions.find((x) => x.id === id);
    return p ? toLive(p) : null;
  }, [s, id]);
}

export function useSimLimitOrders(id: string | undefined): LimitOrdersResponse | null {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => {
    if (!isSimId(id)) return null;
    const p = s.positions.find((x) => x.id === id);
    return p ? toOrders(p) : null;
  }, [s, id]);
}

export function useSimLog(): SimLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot).log;
}
