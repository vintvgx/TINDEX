import { useCallback, useEffect, useRef, useState } from 'react';
import { useThemeColors } from '@/lib/useColorScheme';
import {
  useRunSimulation,
  type SimScenario,
  type SimProfileKey,
  type SimulationResult,
} from '@/hooks/mutations/strategy/useRunSimulation';
import { useStrategyLivePrice, type LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { ProfileKey } from '@/common/types/strategy';

export interface SimEvent {
  tick: number;
  label: string;
  color: string;
}

/**
 * Structured (chart-ready) counterpart to SimEvent: same flag transitions,
 * but carrying the underlying-price level each fired at instead of prose —
 * SimulationChartScreen maps `tick` to its own locally-grown bar index and
 * renders these as AdvancedPriceChart eventMarkers.
 */
export interface SimMarker {
  tick: number;
  kind: 'entry' | 'tp1' | 'tp2' | 'stop';
  label: string;
  price: number;
  color: string;
}

export type SimLeg = 'call' | 'put';
export type SimPhase = 'pick' | 'running' | 'done';

interface UseSimulationRunnerOptions {
  /** Attach the simulation's WS/notifications to an existing engine. Omit to
   *  let the backend fall back to a standalone throwaway IWM engine. */
  strategyId?: string;
  /** Skip real Expo push delivery — WS fan-out (chart, event log, stats)
   *  still updates live either way. */
  suppressPush?: boolean;
}

/**
 * Shared phase/tick/event-log state machine driving any simulation UI —
 * originally inline in SimulationModal.tsx, extracted so the bottom-sheet
 * modal (strategy.tsx's "Testing" section) and the standalone full-screen
 * SimulationChartScreen (ORB tab's "Run Simulation" menu item) share the
 * same WS-flag-watching logic instead of duplicating it.
 */
export function useSimulationRunner({ strategyId, suppressPush }: UseSimulationRunnerOptions) {
  const colors = useThemeColors();
  const { mutate: runSim, isPending } = useRunSimulation();

  const [phase, setPhase]             = useState<SimPhase>('pick');
  const [scenario, setScenario]       = useState<SimScenario | null>(null);
  const [liveStratId, setLiveStratId] = useState<string | undefined>(strategyId);
  const [simResult, setSimResult]     = useState<SimulationResult | null>(null);
  const [events, setEvents]           = useState<SimEvent[]>([]);
  const [markers, setMarkers]         = useState<SimMarker[]>([]);
  const [elapsed, setElapsed]         = useState(0);
  const [currentTick, setCurrentTick] = useState(0);
  const [totalTicks, setTotalTicks]   = useState(10);

  // Reversal-specific state
  const [simLeg, setSimLeg]       = useState<SimLeg>('call');
  const [callPnl, setCallPnl]     = useState<number>(0);

  // Snapshot of live data for the current run — cleared on every new start
  // so stale data from the previous run never leaks into the UI.
  const [displayLive, setDisplayLive] = useState<LivePriceData | null>(null);

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLive  = useRef<LivePriceData | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: live, connected } = useStrategyLivePrice(
    liveStratId,
    phase === 'running',
  );

  // ── Sync live → displayLive (current run only) ─────────────────────────────

  useEffect(() => {
    if (!live || phase !== 'running') return;
    setDisplayLive(live);
  }, [live, phase]);

  // ── Watch incoming WS messages ─────────────────────────────────────────────

  useEffect(() => {
    if (!live || phase !== 'running') return;
    const msg = live as any;

    // Advance tick counter
    if (msg.sim_tick != null && msg.sim_tick !== currentTick) {
      setCurrentTick(msg.sim_tick);
    }
    if (msg.sim_total != null) {
      setTotalTicks(msg.sim_total);
    }

    // Track reversal leg transitions
    if (msg.sim_leg != null) {
      if (msg.sim_leg === 'put' && simLeg !== 'put') {
        setSimLeg('put');
        // call_pnl comes embedded in the first PUT-leg message
        if (msg.call_pnl != null) setCallPnl(msg.call_pnl);
      } else if (msg.sim_leg === 'call' && simLeg !== 'call') {
        setSimLeg('call');
      }
    }

    // Detect flag transitions → event log entries + chart markers
    const prev = prevLive.current;
    if (!prev?.tp1_hit && live.tp1_hit) {
      const legLabel = scenario === 'reversal' ? ' (PUT)' : '';
      const tick = msg.sim_tick ?? 3;
      addEvent(tick, `TP1 hit — partial close 3 contracts${legLabel}`, colors.success);
      if (msg.tp1_underlying != null) addMarker(tick, 'tp1', 'TP1', msg.tp1_underlying, colors.success);
    }
    if (!prev?.tp2_hit && live.tp2_hit) {
      const legLabel = scenario === 'reversal' ? ' (PUT)' : '';
      const tick = msg.sim_tick ?? 6;
      addEvent(tick, `TP2 hit — partial close 1 contract${legLabel}`, colors.success);
      if (msg.tp2_underlying != null) addMarker(tick, 'tp2', 'TP2', msg.tp2_underlying, colors.success);
    }
    if (prev && prev.qty_remaining > 0 && live.qty_remaining === 0 && live.tp2_hit) {
      // Both "trail" and "be_hold" runner modes land here (either a trailing
      // stop or a breakeven stop closed the final contract) — kept
      // mode-agnostic since the WS payload doesn't carry runner_mode.
      const tick = msg.sim_tick ?? 10;
      addEvent(tick, 'Runner closed — position fully closed', '#FFD60A');
      if (msg.underlying_price != null) addMarker(tick, 'stop', 'Closed', msg.underlying_price, '#FFD60A');
    }
    if (prev && prev.qty_remaining > 0 && live.qty_remaining === 0 && !live.tp1_hit) {
      const isReversalCall = scenario === 'reversal' && msg.sim_leg === 'call';
      const tick = msg.sim_tick ?? 4;
      addEvent(
        tick,
        isReversalCall ? 'CALL hard stop — reversal signal sent' : 'Hard stop hit — fully closed',
        colors.error,
      );
      if (msg.stop_underlying != null) {
        addMarker(tick, 'stop', isReversalCall ? 'Stop' : 'Hard Stop', msg.stop_underlying, colors.error);
      }
      if (isReversalCall) {
        addEvent(tick, 'PUT entered @ $1.50 — reversal trade live', '#FFD60A');
      }
    }

    prevLive.current = { ...live };
  }, [live]);

  // ── Watch for simulation completion ───────────────────────────────────────

  useEffect(() => {
    if (phase !== 'running' || !live) return;
    const msg   = live as any;
    const isEnd = msg.sim_tick >= msg.sim_total && msg.sim_leg !== 'call';
    const allClosed = live.qty_remaining === 0;
    if (!isEnd && !allClosed) return;
    if (doneTimer.current) return;

    doneTimer.current = setTimeout(() => {
      setPhase('done');
      if (timerRef.current) clearInterval(timerRef.current);
    }, 2000);
    return () => {
      if (doneTimer.current) { clearTimeout(doneTimer.current); doneTimer.current = null; }
    };
  }, [live, phase]);

  function addEvent(tick: number, label: string, color: string) {
    setEvents(prev => [...prev, { tick, label, color }]);
  }

  function addMarker(tick: number, kind: SimMarker['kind'], label: string, price: number, color: string) {
    setMarkers(prev => [...prev, { tick, kind, label, price, color }]);
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  const handleStart = useCallback((chosen: SimScenario, profile?: SimProfileKey | ProfileKey) => {
    // Clear all state from any previous run before starting
    if (timerRef.current)  clearInterval(timerRef.current);
    if (doneTimer.current) clearTimeout(doneTimer.current);
    timerRef.current  = null;
    doneTimer.current = null;

    setScenario(chosen);
    setPhase('running');
    setCurrentTick(0);
    setTotalTicks(chosen === 'loss' ? 4 : 10);
    setElapsed(0);
    setDisplayLive(null);    // clear stale data from previous run
    setSimLeg('call');
    setCallPnl(0);
    setSimResult(null);
    setMarkers([]);
    prevLive.current = null;
    setEvents([{
      tick:  0,
      label: chosen === 'reversal'
        ? 'CALL entered — IWM 221C @ $1.50'
        : 'Trade entered — IWM 221C @ $1.50',
      color: colors.accent,
    }]);

    runSim(
      { scenario: chosen, strategy_id: strategyId, profile, suppress_push: suppressPush },
      {
        onSuccess: (res) => {
          setLiveStratId(res.strategy_id);
          setSimResult(res);
          // entry_underlying == orb_high always (see _underlying_at in
          // simulation.py) — known from the POST response, no need to wait
          // for the first WS tick to place the entry marker.
          // textSecondary, not accent — matches the "Entry" reference line
          // elsewhere in SimulationChartScreen, and avoids colors.accent
          // here specifically: the chart draws this marker's label in fixed
          // white text, and accent is a LIGHT fill in dark mode, so white
          // text on it would be barely legible.
          setMarkers([{ tick: 0, kind: 'entry', label: 'Entry', price: res.orb_high, color: colors.textSecondary }]);
          timerRef.current = setInterval(() =>
            setElapsed(e => e + 1), 1000);
        },
        onError: () => setPhase('pick'),
      },
    );
  }, [strategyId, suppressPush, runSim, colors.accent]);

  // ── Close / reset ──────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (timerRef.current)  clearInterval(timerRef.current);
    if (doneTimer.current) clearTimeout(doneTimer.current);
    timerRef.current  = null;
    doneTimer.current = null;

    setPhase('pick');
    setScenario(null);
    setEvents([]);
    setMarkers([]);
    setElapsed(0);
    setCurrentTick(0);
    setTotalTicks(10);
    setDisplayLive(null);
    setSimLeg('call');
    setCallPnl(0);
    setSimResult(null);
    prevLive.current = null;
  }, []);

  return {
    phase, scenario, events, markers, elapsed, currentTick, totalTicks,
    simLeg, callPnl, displayLive, connected, simResult, isPending,
    handleStart, handleClose,
  };
}
