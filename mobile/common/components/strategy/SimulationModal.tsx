import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useRunSimulation, type SimScenario } from '@/hooks/mutations/strategy/useRunSimulation';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SimEvent {
  tick:  number;
  label: string;
  color: string;
}

interface Props {
  visible:    boolean;
  onClose:    () => void;
  strategyId: string | undefined;
}

type Phase   = 'pick' | 'running' | 'done';
type SimLeg  = 'call' | 'put';

// ── Constants ──────────────────────────────────────────────────────────────────

const SECONDS_PER_TICK = 6;

const PROFIT_PREVIEW = [
  { min: 'Min 3',  desc: 'TP1 hit → 3 contracts closed @ $2.25 (+50%)' },
  { min: 'Min 5',  desc: '30-min update notification fires' },
  { min: 'Min 6',  desc: 'TP2 hit → runner continues @ $3.00 (+100%)' },
  { min: 'Min 9',  desc: 'Runner peaks +200% @ $4.50' },
  { min: 'Min 10', desc: 'Trailing stop fires — fully closed' },
];

const LOSS_PREVIEW = [
  { min: 'Min 1',   desc: 'Price begins declining' },
  { min: 'Min 2–3', desc: 'Continues lower, approaching hard stop' },
  { min: 'Min 4',   desc: 'Hard stop hit → full close @ $0.95 (−35%)' },
];

const REVERSAL_PREVIEW = [
  { min: 'Min 1–3', desc: 'CALL entered, price declines toward stop' },
  { min: 'Min 4',   desc: 'Hard stop triggered — CALL exits at −$330' },
  { min: 'Min 4',   desc: 'Reversal detected → PUT entered @ $1.50' },
  { min: 'Min 7',   desc: 'TP1 hit on PUT — 3 contracts closed (+50%)' },
  { min: 'Min 16',  desc: 'Runner trail stop fires — Net P&L: +$480' },
];

// ── SimulationModal ────────────────────────────────────────────────────────────

export function SimulationModal({ visible, onClose, strategyId }: Props) {
  const colors = useThemeColors();
  const { mutate: runSim, isPending } = useRunSimulation();

  const [phase, setPhase]             = useState<Phase>('pick');
  const [scenario, setScenario]       = useState<SimScenario | null>(null);
  const [liveStratId, setLiveStratId] = useState<string | undefined>(strategyId);
  const [events, setEvents]           = useState<SimEvent[]>([]);
  const [elapsed, setElapsed]         = useState(0);
  const [currentTick, setCurrentTick] = useState(0);
  const [totalTicks, setTotalTicks]   = useState(10);

  // Reversal-specific state
  const [simLeg, setSimLeg]       = useState<SimLeg>('call');
  const [callPnl, setCallPnl]     = useState<number>(0);

  // Snapshot of live data for the current run — cleared on every new start
  // so stale data from the previous run never leaks into the UI.
  const [displayLive, setDisplayLive] = useState<any>(null);

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLive  = useRef<any>(null);
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

    // Detect flag transitions → event log entries
    const prev = prevLive.current;
    if (!prev?.tp1_hit && live.tp1_hit) {
      const legLabel = scenario === 'reversal' ? ' (PUT)' : '';
      addEvent(msg.sim_tick ?? 3, `TP1 hit — partial close 3 contracts${legLabel}`, colors.success);
    }
    if (!prev?.tp2_hit && live.tp2_hit) {
      const legLabel = scenario === 'reversal' ? ' (PUT)' : '';
      addEvent(msg.sim_tick ?? 6, `TP2 hit — partial close 1 contract${legLabel}`, colors.success);
    }
    if (prev && prev.qty_remaining > 0 && live.qty_remaining === 0 && live.tp2_hit) {
      addEvent(msg.sim_tick ?? 10, 'Runner trail stop — fully closed', '#FFD60A');
    }
    if (prev && prev.qty_remaining > 0 && live.qty_remaining === 0 && !live.tp1_hit) {
      const isReversalCall = scenario === 'reversal' && msg.sim_leg === 'call';
      addEvent(
        msg.sim_tick ?? 4,
        isReversalCall ? 'CALL hard stop — reversal signal sent' : 'Hard stop hit — fully closed',
        colors.error,
      );
      if (isReversalCall) {
        addEvent(msg.sim_tick ?? 4, 'PUT entered @ $1.50 — reversal trade live', '#FFD60A');
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

  // ── Start ──────────────────────────────────────────────────────────────────

  const handleStart = useCallback((chosen: SimScenario) => {
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
    prevLive.current = null;
    setEvents([{
      tick:  0,
      label: chosen === 'reversal'
        ? 'CALL entered — IWM 221C @ $1.50'
        : 'Trade entered — IWM 221C @ $1.50',
      color: colors.accent,
    }]);

    runSim(
      { scenario: chosen, strategy_id: strategyId },
      {
        onSuccess: (res) => {
          setLiveStratId(res.strategy_id);
          timerRef.current = setInterval(() =>
            setElapsed(e => e + 1), 1000);
        },
        onError: () => setPhase('pick'),
      },
    );
  }, [strategyId, runSim, colors.accent]);

  // ── Close / reset ──────────────────────────────────────────────────────────

  const handleClose = () => {
    if (timerRef.current)  clearInterval(timerRef.current);
    if (doneTimer.current) clearTimeout(doneTimer.current);
    timerRef.current  = null;
    doneTimer.current = null;

    setPhase('pick');
    setScenario(null);
    setEvents([]);
    setElapsed(0);
    setCurrentTick(0);
    setTotalTicks(10);
    setDisplayLive(null);
    setSimLeg('call');
    setCallPnl(0);
    prevLive.current = null;
    onClose();
  };

  const pnl      = displayLive?.pnl ?? 0;
  const netPnl   = scenario === 'reversal' && simLeg === 'put' ? callPnl + pnl : pnl;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const netColor = netPnl >= 0 ? colors.success : colors.error;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '92%',
          paddingBottom: Platform.OS === 'ios' ? 40 : 24,
        }}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 2 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>

          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: colors.separator,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>
                Run Simulation
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                Compressed minutes · real push notifications · live P&L
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={{
                width: 30, height: 30, borderRadius: 15,
                backgroundColor: colors.surfaceSecondary,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}
          >

            {/* ── PICK ───────────────────────────────────────────────────── */}
            {phase === 'pick' && (
              <>
                <ScenarioLabel colors={colors} text="Choose a Scenario" />

                <ScenarioCard
                  emoji="📈"
                  title="Profitable Trade"
                  subtitle="+$810 simulated P&L"
                  accentColor={colors.success}
                  items={PROFIT_PREVIEW}
                  disabled={isPending}
                  colors={colors}
                  onPress={() => handleStart('profit')}
                />

                <ScenarioCard
                  emoji="📉"
                  title="Stopped Out"
                  subtitle="−$330 simulated P&L"
                  accentColor={colors.error}
                  items={LOSS_PREVIEW}
                  disabled={isPending}
                  colors={colors}
                  onPress={() => handleStart('loss')}
                />

                <ScenarioCard
                  emoji="🔄"
                  title="Call Fails → Reversal PUT"
                  subtitle="Net +$480 (−$330 CALL + $810 PUT)"
                  accentColor="#FF9F0A"
                  items={REVERSAL_PREVIEW}
                  disabled={isPending}
                  colors={colors}
                  onPress={() => handleStart('reversal')}
                />

                <Text style={{
                  color: colors.textTertiary, fontSize: 12,
                  textAlign: 'center', marginTop: 10,
                }}>
                  Each simulated minute takes 6 real seconds.{'\n'}
                  Push notifications fire at every exit event.
                </Text>
              </>
            )}

            {/* ── RUNNING / DONE ─────────────────────────────────────────── */}
            {(phase === 'running' || phase === 'done') && (
              <>
                {/* Status row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  {phase === 'running' ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textTertiary }} />
                  )}
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 }}>
                    {phase === 'done'
                      ? `${scenarioLabel(scenario!)} Complete`
                      : `${scenarioLabel(scenario!)} Running…`
                    }
                  </Text>
                  {phase === 'running' && (
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                      {elapsed}s
                    </Text>
                  )}
                </View>

                {/* Reversal leg badge */}
                {scenario === 'reversal' && phase === 'running' && (
                  <View style={{
                    flexDirection: 'row', gap: 8, marginBottom: 12,
                  }}>
                    <LegBadge label="CALL" active={simLeg === 'call'} done={simLeg === 'put'} colors={colors} />
                    <LegBadge label="PUT"  active={simLeg === 'put'}  done={false}             colors={colors} />
                  </View>
                )}

                {/* Tick timeline */}
                <TickTimeline
                  currentTick={currentTick}
                  totalTicks={totalTicks}
                  scenario={scenario!}
                  simLeg={scenario === 'reversal' ? simLeg : undefined}
                  colors={colors}
                />

                {/* Live P&L card */}
                {displayLive ? (
                  <View style={{
                    backgroundColor: colors.surfaceSecondary,
                    borderRadius: 16, padding: 16, marginTop: 14, marginBottom: 14,
                    borderWidth: 1.5, borderColor: pnlColor + '40',
                  }}>
                    <View style={{
                      position: 'absolute', top: 10, right: 10,
                      backgroundColor: colors.accent + '22',
                      borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    }}>
                      <Text style={{ color: colors.accent, fontSize: 9, fontWeight: '800' }}>SIM</Text>
                    </View>

                    {/* Current leg stats */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 }}>
                      <Stat label="Price"  value={`$${displayLive.mid_price.toFixed(2)}`}                           color={colors.text} />
                      <Stat label="P&L"    value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}                      color={pnlColor} />
                      <Stat label="Change" value={`${displayLive.pnl_pct >= 0 ? '+' : ''}${displayLive.pnl_pct.toFixed(0)}%`} color={pnlColor} />
                      <Stat label="Qty"    value={String(displayLive.qty_remaining)}                                 color={colors.text} />
                    </View>

                    {/* Net P&L row for reversal */}
                    {scenario === 'reversal' && simLeg === 'put' && (
                      <View style={{
                        flexDirection: 'row', justifyContent: 'space-between',
                        borderTopWidth: 1, borderTopColor: colors.border,
                        paddingTop: 10, marginBottom: 12,
                      }}>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', marginBottom: 3 }}>CALL P&L</Text>
                          <Text style={{ color: colors.error, fontSize: 14, fontWeight: '700' }}>
                            ${callPnl.toFixed(2)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', marginBottom: 3 }}>PUT P&L</Text>
                          <Text style={{ color: pnlColor, fontSize: 14, fontWeight: '700' }}>
                            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', marginBottom: 3 }}>NET</Text>
                          <Text style={{ color: netColor, fontSize: 14, fontWeight: '800' }}>
                            {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    )}

                    {/* Level pills */}
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <LevelPill label="TP1"  value={`$${displayLive.tp1.toFixed(2)}`}       hit={displayLive.tp1_hit}  colors={colors} />
                      <LevelPill label="TP2"  value={`$${displayLive.tp2.toFixed(2)}`}       hit={displayLive.tp2_hit}  colors={colors} />
                      <LevelPill label="STOP" value={`$${displayLive.hard_stop.toFixed(2)}`} isStop                     colors={colors} />
                    </View>
                  </View>
                ) : phase === 'running' && (
                  <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10, marginBottom: 14 }}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      Waiting for first tick…
                    </Text>
                  </View>
                )}

                {/* Event log */}
                {events.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    <ScenarioLabel colors={colors} text="Event Log" />
                    {events.map((ev, i) => (
                      <View
                        key={i}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10,
                          paddingVertical: 9,
                          borderBottomWidth: i < events.length - 1 ? 1 : 0,
                          borderBottomColor: colors.separator,
                        }}
                      >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ev.color }} />
                        <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', width: 42 }}>
                          {ev.tick === 0 ? 'Entry' : `Min ${ev.tick}`}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
                          {ev.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Final net P&L summary on done for reversal */}
                {phase === 'done' && scenario === 'reversal' && (
                  <View style={{
                    backgroundColor: (netPnl >= 0 ? colors.success : colors.error) + '18',
                    borderRadius: 14, padding: 14, marginBottom: 12,
                    borderWidth: 1, borderColor: (netPnl >= 0 ? colors.success : colors.error) + '40',
                  }}>
                    <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>
                      REVERSAL NET P&L
                    </Text>
                    <Text style={{ color: netColor, fontSize: 26, fontWeight: '800' }}>
                      {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                      CALL: ${callPnl.toFixed(2)}  ·  PUT: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </Text>
                  </View>
                )}

                {phase === 'done' && (
                  <TouchableOpacity
                    onPress={handleClose}
                    style={{
                      backgroundColor: colors.accent,
                      borderRadius: 14, paddingVertical: 14,
                      alignItems: 'center', marginTop: 6,
                    }}
                  >
                    <Text style={{ color: colors.accentForeground, fontSize: 15, fontWeight: '700' }}>Done</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function scenarioLabel(s: SimScenario): string {
  if (s === 'profit')   return '📈 Profitable';
  if (s === 'loss')     return '📉 Loss';
  if (s === 'reversal') return '🔄 Reversal';
  return '';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScenarioLabel({ text, colors }: { text: string; colors: any }) {
  return (
    <Text style={{
      color: colors.textTertiary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
    }}>
      {text}
    </Text>
  );
}

function ScenarioCard({
  emoji, title, subtitle, accentColor, items, disabled, colors, onPress,
}: {
  emoji: string; title: string; subtitle: string;
  accentColor: string;
  items: { min: string; desc: string }[];
  disabled: boolean; colors: any; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={{
        backgroundColor: colors.surfaceSecondary,
        borderRadius: 16, padding: 18, marginBottom: 12,
        borderWidth: 1.5, borderColor: accentColor + '55',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <View style={{
          width: 40, height: 40, borderRadius: 12,
          backgroundColor: accentColor + '22',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 20 }}>{emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: accentColor, fontSize: 12, fontWeight: '600', marginTop: 1 }}>
            {subtitle}
          </Text>
        </View>
      </View>
      {items.map(({ min, desc }) => (
        <View key={min} style={{ flexDirection: 'row', gap: 8, marginBottom: 5 }}>
          <Text style={{ color: accentColor, fontSize: 11, fontWeight: '700', width: 52 }}>
            {min}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }}>
            {desc}
          </Text>
        </View>
      ))}
    </TouchableOpacity>
  );
}

function LegBadge({
  label, active, done, colors,
}: { label: string; active: boolean; done: boolean; colors: any }) {
  const color = label === 'CALL' ? colors.error : colors.success;
  return (
    <View style={{
      flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10,
      backgroundColor: (active || done) ? color + '18' : colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: active ? color : colors.border,
    }}>
      <Text style={{ color: active ? color : colors.textTertiary, fontSize: 12, fontWeight: '700' }}>
        {label} {done ? '✓' : active ? '●' : ''}
      </Text>
    </View>
  );
}

function TickTimeline({
  currentTick, totalTicks, scenario, simLeg, colors,
}: {
  currentTick: number;
  totalTicks:  number;
  scenario:    SimScenario;
  simLeg?:     SimLeg;
  colors:      any;
}) {
  const isLoss   = scenario === 'loss' || (scenario === 'reversal' && simLeg === 'call');
  const barColor = isLoss ? colors.error : colors.success;

  const eventTicks = (() => {
    if (scenario === 'profit') return [3, 5, 6, 10];
    if (scenario === 'loss')   return [4];
    if (scenario === 'reversal') {
      return simLeg === 'call' ? [4] : [3, 5, 6, 10];
    }
    return [];
  })();

  return (
    <View style={{ marginBottom: 4 }}>
      {/* Dot row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 }}>
        {Array.from({ length: totalTicks }, (_, i) => {
          const tick      = i + 1;
          const isPast    = tick <= currentTick;
          const isCurrent = tick === currentTick;
          const isEvent   = eventTicks.includes(tick);
          return (
            <View key={tick} style={{ flex: 1, alignItems: 'center' }}>
              {isEvent && (
                <Text style={{ color: colors.textTertiary, fontSize: 8, marginBottom: 2 }}>
                  {tick}m
                </Text>
              )}
              <View style={{
                width:  isCurrent ? 11 : (isEvent ? 9 : 6),
                height: isCurrent ? 11 : (isEvent ? 9 : 6),
                borderRadius: 6,
                backgroundColor: isCurrent ? '#FFD60A' : (isPast ? barColor : colors.border),
              }} />
            </View>
          );
        })}
      </View>
      {/* Progress bar */}
      <View style={{
        height: 3, borderRadius: 2, backgroundColor: colors.border,
        overflow: 'hidden', marginBottom: 16,
      }}>
        <View style={{
          height: '100%', borderRadius: 2,
          width: `${(currentTick / totalTicks) * 100}%`,
          backgroundColor: barColor,
        }} />
      </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: '#8E8E93', fontSize: 10, fontWeight: '600', marginBottom: 3 }}>
        {label}
      </Text>
      <Text style={{ color, fontSize: 18, fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

function LevelPill({ label, value, hit = false, isStop = false, colors }: {
  label: string; value: string; hit?: boolean; isStop?: boolean; colors: any;
}) {
  const color = isStop ? colors.error : (hit ? colors.success : colors.textTertiary);
  return (
    <View style={{
      flex: 1, alignItems: 'center', paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: (hit || isStop) ? color + '18' : colors.surface,
      borderWidth: 1,
      borderColor: (hit || isStop) ? color + '60' : colors.border,
    }}>
      <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color, fontSize: 13, fontWeight: '700', marginTop: 2 }}>{value}</Text>
      {hit && <Text style={{ color, fontSize: 9, marginTop: 1 }}>✓</Text>}
    </View>
  );
}
