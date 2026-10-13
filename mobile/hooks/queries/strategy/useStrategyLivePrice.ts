import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { PendingPriceUpdate } from '@/common/types/strategy';
import { isSimId, useSimLive } from '@/lib/devSim/simPositions';
import {
  EMPTY_SNAPSHOT, getLiveSnapshot, patchLiveData, subscribeLive, type LiveSnapshot,
} from './strategyLiveStore';

export interface LivePriceData {
  contract:      string;
  mid_price:     number;
  entry_premium: number;
  pnl:           number;
  pnl_pct:       number;
  qty_remaining: number;
  /** mid_price * qty_remaining * 100 — the position's live mark-to-market
   *  value, already computed server-side on every tick (orb_engine.py's
   *  broadcast_price_update). Lets the client derive live account equity
   *  without a separate REST poll. */
  market_value:  number;
  tp1_hit:       boolean;
  tp2_hit:       boolean;
  hard_stop:     number;
  tp1:           number;
  tp2:           number;
  /** Live ratcheting trail floor — only meaningful once `runner_mode ===
   *  "trail"` and tp1_hit; the runner force-sells if mid_price dips to/below
   *  this. Recomputed every tick server-side (ExitManager.evaluate()), only
   *  ever moves up. */
  runner_trail?: number;
  /** True while a SL_5/SL_10 (or REVERSAL) grace window is open — the
   *  premium is at/below hard_stop but hasn't been force-sold yet. See
   *  exit_manager.py's sl_grace_enabled. */
  sl_grace_active?:      boolean;
  /** Absolute ISO timestamp the grace window force-sells at, if still below
   *  the stop then. Always compute a countdown as `deadline - Date.now()`
   *  every render — never run an independent local timer — so the displayed
   *  countdown can't drift from the backend's own clock. */
  sl_grace_deadline?:    string | null;
  /** Absolute ISO timestamp: if the premium is currently recovered above the
   *  stop, this is when that recovery will have held long enough (60s) to
   *  cancel the grace window. Null while price is still at/below the stop. */
  sl_recovery_deadline?: string | null;
  /** False for a 1-contract entry regardless of profile — TP2 is never
   *  reachable. See common/types/strategy.ts's StrategyPosition.use_tp2. */
  use_tp2?: boolean;
  /** Current stop-type CONFIGURATION (Hard Stop vs SL timer, and which
   *  duration) — distinct from sl_grace_active above, which is only true
   *  while a grace window is actively counting down. See
   *  ExitManager.to_dict(). */
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
  /** Whether the hard stop-loss / TP1+TP2 exits are active for this
   *  position — see ExitManager.to_dict(). Defaults true when absent. */
  sl_enabled?: boolean;
  tp_enabled?: boolean;
  /** Absolute worst-case floor price under the SL grace timer — null if
   *  this trade's profile never defined one. Bypasses the grace window
   *  entirely and force-sells if hit. See exit_manager.py's
   *  _sl_outer_floor / HARD_STOP_FLOOR. */
  sl_outer_floor?: number | null;
  /** Per-trade on/off for the floor above — defaults true whenever
   *  sl_outer_floor is set; a trader can turn it off (e.g. for a swing
   *  meant to be held through a drop past it) via the Advanced sheet. */
  sl_floor_enabled?: boolean;
  /** Post-TP1 breakeven grace — see ExitManager.to_dict(). */
  be_grace_seconds?: number | null;
  be_grace_active?: boolean;
  be_grace_deadline?: string | null;
  /** Current runner/cascade CONFIGURATION for this open trade (not just the
   *  profile default) — see exit_manager.py's to_dict(). Lets EditExitsModal
   *  pre-select the toggle to what's actually in effect right now. */
  runner_mode?: 'trail' | 'be_hold' | 'none';
  cascade_enabled?: boolean;
  /** Limit sell ladder: latest option bid/ask (either side may be null on a
   *  one-sided quote) and contracts resting in limit sells vs still free. */
  bid?: number | null;
  ask?: number | null;
  qty_working?: number;
  qty_available?: number;
  // ── Simulation-only fields (all optional — absent on a real live position) ──
  sim?:               boolean;
  sim_tick?:          number;
  sim_total?:         number;
  sim_scenario?:      string;
  sim_leg?:           'call' | 'put';
  call_pnl?:          number;
  /** Synthetic IWM underlying price mapped from the option premium — see
   *  api/services/strategy/simulation.py's _underlying_at. Feeds the
   *  simulation chart's candles/reference lines, which plot on a real
   *  price axis rather than the raw option premium. */
  underlying_price?:  number;
  entry_underlying?:  number;
  tp1_underlying?:    number;
  tp2_underlying?:    number;
  /** Recomputed every tick — moves to entry_underlying once TP1 fires
   *  (breakeven stop), same as hard_stop does on the premium side. */
  stop_underlying?:   number;
}

interface UseStrategyLivePriceResult {
  data:               LivePriceData | null;
  /** Live premium + recomputed SL/TP1/TP2 preview while a confirm_entry trade
   *  is pending approval — null once a position is open (server stops sending
   *  this type and starts sending "price_update" instead) or nothing pending. */
  pendingPriceData:   PendingPriceUpdate | null;
  connected:          boolean;
  /** Just back from the background, waiting for the fresh socket's first
   *  price — show a skeleton, not the old value (see strategyLiveStore). */
  resyncing:          boolean;
  /** Merge fields into the current WS snapshot immediately (e.g. right after
   *  a stop/TP edit succeeds server-side) instead of waiting for the next
   *  "price_update" tick to catch up — the server confirms the edit over
   *  REST well before the next tick would otherwise reflect it. Shared:
   *  every reader of this position sees the patch. */
  patchData:          (patch: Partial<LivePriceData>) => void;
}

const noopUnsubscribe = () => {};
const subscribeNothing = () => noopUnsubscribe;
const getEmpty = () => EMPTY_SNAPSHOT;

/**
 * Real-time option mid-price + P&L for one position, streamed from
 * /ws/strategy/<strategyId>/live.
 *
 * The socket is shared app-wide (see strategyLiveStore.ts): every component
 * reading the same strategyId shares ONE connection, which reconnects
 * automatically while anyone is subscribed. Pass enabled=false (or omit
 * strategyId) when no position is open to avoid holding a connection.
 */
export function useStrategyLivePrice(
  strategyId: string | undefined,
  enabled: boolean = true,
  onPositionClosed?: () => void,
): UseStrategyLivePriceResult {
  // Keep callback in a ref so changing it doesn't resubscribe
  const onPositionClosedRef = useRef(onPositionClosed);
  onPositionClosedRef.current = onPositionClosed;

  // Dev simulated position: its ticks come from the in-app simulator — no socket.
  const sim = isSimId(strategyId);
  const simLive = useSimLive(strategyId);

  const id = enabled && strategyId && !sim ? strategyId : null;
  const subscribe = useCallback(
    (onChange: () => void) =>
      id ? subscribeLive(id, onChange, () => onPositionClosedRef.current?.()) : noopUnsubscribe,
    [id],
  );
  const getSnapshot = useCallback(() => (id ? getLiveSnapshot(id) : EMPTY_SNAPSHOT), [id]);
  const snap = useSyncExternalStore(id ? subscribe : subscribeNothing, id ? getSnapshot : getEmpty);

  const patchData = useCallback((patch: Partial<LivePriceData>) => {
    if (id) patchLiveData(id, patch);
  }, [id]);

  // The simulator applies exit edits synchronously, so an optimistic patch
  // has nothing to bridge — and layering one on would hide its own later
  // changes (e.g. the stop moving to breakeven after TP1).
  const simPatchData = useCallback((_patch: Partial<LivePriceData>) => {}, []);
  if (sim) {
    return {
      // useSimLive returns a stable object until the simulator ticks — a new
      // object per render loops consumers that push it into parent state.
      data: simLive,
      pendingPriceData: null,
      connected: !!simLive,
      resyncing: false,
      patchData: simPatchData,
    };
  }
  return { data: snap.data, pendingPriceData: snap.pendingPriceData, connected: snap.connected, resyncing: snap.resyncing, patchData };
}

/**
 * Latest shared WS snapshot for each of `strategyIds`, keyed by id — holding
 * every one of those sockets open while mounted. Lets a consumer with no
 * position rows on screen (Home's account card, the chart tape) read live
 * marks without a REST poll, and without duplicating any socket a row
 * already holds. Dev simulated ids are skipped (no socket behind them).
 */
export function useStrategyLiveValues(strategyIds: string[]): Record<string, LiveSnapshot> {
  const key = useMemo(
    () => Array.from(new Set(strategyIds.filter((id) => !isSimId(id)))).sort().join('|'),
    [strategyIds],
  );
  const ids = useMemo(() => (key ? key.split('|') : []), [key]);

  const subscribe = useCallback((onChange: () => void) => {
    const unsubs = ids.map((id) => subscribeLive(id, onChange));
    return () => unsubs.forEach((u) => u());
  }, [ids]);

  // Must return the same object until something actually changes, or
  // useSyncExternalStore re-renders forever.
  const cache = useRef<{ ids: string[]; snaps: Record<string, LiveSnapshot> }>({ ids: [], snaps: {} });
  const getSnapshot = useCallback(() => {
    const prev = cache.current;
    const sameIds = prev.ids === ids;
    if (sameIds && ids.every((id) => prev.snaps[id] === getLiveSnapshot(id))) return prev.snaps;
    const snaps: Record<string, LiveSnapshot> = {};
    for (const id of ids) snaps[id] = getLiveSnapshot(id);
    cache.current = { ids, snaps };
    return snaps;
  }, [ids]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
