// Chart long-press + / TP / SL chips and set-line edits (spec
// chart-inline-exit-lines 2026-11-10). Pure planning: each function turns a
// chart action into the PATCH /exits body the edit sheet used to send (same
// write path, no new endpoint) plus the toast for a successful save — or
// the reason it can't be sent. Every other guard (profitable side, already
// reached, duplicates, the TP cap) is the backend's; its reason is toasted.

import type { LadderRung, LivePriceData, TpRungInput } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { premiumAt, type Quote } from '@/lib/exitConversion';

export type ExitLive = LivePriceData & { tp_ladder?: LadderRung[] | null; sl_stock_price?: number | null };
export type ExitPlan = { body: Record<string, unknown>; done: string } | { error: string };

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const $ = (n: number) => `$${n.toFixed(2)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The user's TP lines still to fire, as PATCH tp_rungs entries. */
export function userRungs(ladder: LadderRung[] | null | undefined): TpRungInput[] {
  return (ladder ?? [])
    .filter(r => r.source !== 'engine' && !r.hit)
    .map(r => ({
      id: r.key, premium: r.premium, qty: r.qty, stock_price: r.stock_price ?? null,
      source: (r.source === 'chart-long-press' ? 'chart-long-press' : 'edit-card') as TpRungInput['source'],
    }));
}

/** Contracts held by unfired user lines (the TP chip's cap, §3). */
export function reservedQty(live: ExitLive, exceptKey?: string | null): number {
  return userRungs(live.tp_ladder).filter(r => r.id !== exceptKey).reduce((n, r) => n + r.qty, 0);
}

/** Which chips a long-press shows: TP/SL only with open contracts (§1.1);
 *  TP grays out once every open contract has a line (§3). */
export function chipState(live: ExitLive | null | undefined): { open: boolean; tpAllowed: boolean } {
  const open = !!live && (live.qty_remaining ?? 0) > 0;
  return { open, tpAllowed: open && reservedQty(live!) < live!.qty_remaining };
}

const hasStop = (live: ExitLive) =>
  isNum(live.sl_stock_price) || (live.sl_enabled !== false && isNum(live.hard_stop) && live.hard_stop > 0);

/** TP / SL chip at a stock price. `originKey`: the line that was dragged
 *  across the current price and is waiting on this choice (§1.3). */
export function planChip(kind: 'tp' | 'sl', price: number, live: ExitLive, originKey: string | null = null): ExitPlan {
  const p = round2(price);
  const originIsUserTp = !!originKey && userRungs(live.tp_ladder).some(r => r.id === originKey);
  if (kind === 'tp') {
    const n = live.qty_remaining;
    if (reservedQty(live, originIsUserTp ? originKey : null) >= n) {
      return { error: `All ${n} contract${n === 1 ? '' : 's'} already have TP lines — delete one to add another` };
    }
    const rungs = userRungs(live.tp_ladder).filter(r => !(originIsUserTp && r.id === originKey));
    rungs.push({ premium: null, qty: 1, stock_price: p, source: 'chart-long-press' });
    const body: Record<string, unknown> = { tp_rungs: rungs };
    // A TP tap turns take profit on — never blocked by TP-off (§3).
    if (live.tp_enabled === false) {
      body.tp_enabled = true;
      // An engine TP1 the premium already passed is skipped, not fired (§4.3).
      const passed = isNum(live.tp1) && !live.tp1_hit && isNum(live.mid_price) && live.mid_price >= live.tp1;
      return { body, done: `Take profit on — TP line set at ${$(p)} stock${passed ? ' · your line is live; engine TP1 already passed' : ''}` };
    }
    const moved = originIsUserTp;
    return { body, done: moved ? `TP moved to ${$(p)} stock` : `TP set at ${$(p)} stock — sells 1 when the stock trades there` };
  }
  // One stop per trade: SL sets it, or moves the one that's there (§4).
  const body: Record<string, unknown> = { sl_stock_price: p };
  if (originIsUserTp) body.tp_rungs = userRungs(live.tp_ladder).filter(r => r.id !== originKey);
  return { body, done: hasStop(live) ? `Stop moved to ${$(p)} stock` : `Stop set at ${$(p)} stock — sells all remaining contracts` };
}

/** Is `price` on the wrong side of the stock for this line's kind? (A TP
 *  dragged there would fire at once; a stop dragged there would too.) */
export function crossesPrice(kind: 'TP' | 'SL' | 'BE', price: number, stock: number | null, direction: 'CALL' | 'PUT'): boolean {
  if (!isNum(stock) || kind === 'BE') return false;
  const put = direction === 'PUT';
  return kind === 'TP' ? (put ? price >= stock : price <= stock) : (put ? price <= stock : price >= stock);
}

/** A set line let go at a new stock price (§1.3). */
export function planMove(key: string, kind: 'TP' | 'SL' | 'BE', price: number, live: ExitLive,
                         quote: Quote | null): ExitPlan {
  const p = round2(price);
  if (kind === 'SL') return { body: { sl_stock_price: p }, done: `Stop moved to ${$(p)} stock` };
  if (key === 'tp1' || key === 'tp2') {
    // Engine levels are premiums: moving one by stock price needs a delta.
    if (!quote) return { error: `Moving ${key.toUpperCase()} needs a live delta — set it in the edit modal` };
    const prem = round2(premiumAt(quote, p));
    return { body: { [key]: prem }, done: `${key.toUpperCase()} moved to $${prem.toFixed(2)} (≈ ${$(p)} stock)` };
  }
  const rungs = userRungs(live.tp_ladder);
  if (!rungs.some(r => r.id === key)) return { error: 'That line already sold — it can’t be moved' };
  return {
    body: { tp_rungs: rungs.map(r => (r.id === key ? { ...r, premium: null, stock_price: p } : r)) },
    done: `TP moved to ${$(p)} stock`,
  };
}

/** × on a selected line: a user TP or the stop (§1.3). */
export function planDelete(key: string, kind: 'TP' | 'SL' | 'BE', live: ExitLive): ExitPlan {
  // Clears the stock and premium stop together (redesign spec §3.4).
  if (kind === 'SL') return { body: { sl_enabled: false }, done: 'Stop-loss removed — no stop is active' };
  const rungs = userRungs(live.tp_ladder);
  if (!rungs.some(r => r.id === key)) return { error: 'Only your own TP lines can be deleted here' };
  return { body: { tp_rungs: rungs.filter(r => r.id !== key) }, done: 'TP line deleted — its contract returns to the pool' };
}
