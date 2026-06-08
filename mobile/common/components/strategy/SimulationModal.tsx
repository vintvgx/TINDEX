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

type Phase = 'pick' | 'running' | 'done';

// ── Constants ──────────────────────────────────────────────────────────────────

const TOTAL_TICKS    = 10;
const TOTAL_SECONDS  = TOTAL_TICKS * 6; // 60 s

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

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLive  = useRef<any>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: live, connected } = useStrategyLivePrice(
    liveStratId,
    phase === 'running',
  );

  // ── Watch incoming WS messages ─────────────────────────────────────────────

  useEffect(() => {
    if (!live || phase !== 'running') return;
    const msg = live as any;

    // Advance tick counter
    if (msg.sim_tick != null && msg.sim_tick !== currentTick) {
      setCurrentTick(msg.sim_tick);
    }

    // Detect flag transitions → event log entries
    const prev = prevLive.current;
    if (!prev?.tp1_hit && live.tp1_hit) {
      addEvent(msg.sim_tick ?? 3, 'TP1 hit — partial close (3 contracts)', colors.success);
    }
    if (!prev?.tp2_hit && live.tp2_hit) {
      addEvent(msg.sim_tick ?? 6, 'TP2 hit — partial close (1 contract)', colors.success);
    }
    if (prev && prev.qty_remaining > 0 && live.qty_remaining === 0 && !live.tp1_hit) {
      addEvent(msg.sim_tick ?? 4, 'Hard stop hit — fully closed', colors.error);
    }
    if (prev && prev.qty_remaining > 0 && live.qty_remaining === 0 && live.tp2_hit) {
      addEvent(msg.sim_tick ?? 10, 'Runner trail stop — fully closed', '#FFD60A');
    }

    prevLive.current = { ...live };
  }, [live]);

  // ── Watch for simulation completion ───────────────────────────────────────

  useEffect(() => {
    if (phase !== 'running' || !live) return;
    const msg = live as any;
    const finished = msg.sim_tick >= TOTAL_TICKS || live.qty_remaining === 0;
    if (!finished) return;

    if (doneTimer.current) return; // already scheduled
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
    setScenario(chosen);
    setPhase('running');
    setCurrentTick(0);
    setElapsed(0);
    prevLive.current   = null;
    doneTimer.current  = null;
    setEvents([{ tick: 0, label: 'Trade entered — IWM 221C @ $1.50', color: colors.accent }]);

    runSim(
      { scenario: chosen, strategy_id: strategyId },
      {
        onSuccess: (res) => {
          setLiveStratId(res.strategy_id);
          timerRef.current = setInterval(() =>
            setElapsed(e => Math.min(e + 1, TOTAL_SECONDS)), 1000);
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
    prevLive.current = null;
    onClose();
  };

  const pnlColor = live
    ? (live.pnl >= 0 ? colors.success : colors.error)
    : colors.textSecondary;

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
                10 simulated minutes · real push notifications · live P&L
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
                  subtitle="+$785 simulated P&L"
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
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  gap: 8, marginBottom: 16,
                }}>
                  {phase === 'running' ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <View style={{
                      width: 8, height: 8, borderRadius: 4,
                      backgroundColor: colors.textTertiary,
                    }} />
                  )}
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 }}>
                    {phase === 'done'
                      ? `${scenario === 'profit' ? 'Profitable' : 'Loss'} Simulation Complete`
                      : `${scenario === 'profit' ? '📈 Profitable' : '📉 Loss'} Trade Running…`
                    }
                  </Text>
                  {phase === 'running' && (
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                      {elapsed}s / {TOTAL_SECONDS}s
                    </Text>
                  )}
                </View>

                {/* ── Tick timeline ─────────────────────────────────────── */}
                <TickTimeline
                  currentTick={currentTick}
                  scenario={scenario!}
                  colors={colors}
                />

                {/* ── Live P&L card ──────────────────────────────────────── */}
                {live ? (
                  <View style={{
                    backgroundColor: colors.surfaceSecondary,
                    borderRadius: 16, padding: 16, marginTop: 14, marginBottom: 14,
                    borderWidth: 1.5, borderColor: pnlColor + '40',
                  }}>
                    {/* SIM badge */}
                    <View style={{
                      position: 'absolute', top: 10, right: 10,
                      backgroundColor: colors.accent + '22',
                      borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                    }}>
                      <Text style={{ color: colors.accent, fontSize: 9, fontWeight: '800' }}>SIM</Text>
                    </View>

                    {/* Main stats */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 }}>
                      <Stat label="Price"   value={`$${live.mid_price.toFixed(2)}`}  color={colors.text} />
                      <Stat label="P&L"     value={`${live.pnl >= 0 ? '+' : ''}$${live.pnl.toFixed(2)}`}   color={pnlColor} />
                      <Stat label="Change"  value={`${live.pnl_pct >= 0 ? '+' : ''}${live.pnl_pct.toFixed(0)}%`} color={pnlColor} />
                      <Stat label="Qty"     value={String(live.qty_remaining)}        color={colors.text} />
                    </View>

                    {/* Level pills */}
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <LevelPill label="TP1"  value={`$${live.tp1.toFixed(2)}`} hit={live.tp1_hit}  colors={colors} />
                      <LevelPill label="TP2"  value={`$${live.tp2.toFixed(2)}`} hit={live.tp2_hit}  colors={colors} />
                      <LevelPill label="STOP" value={`$${live.hard_stop.toFixed(2)}`} isStop colors={colors} />
                    </View>
                  </View>
                ) : phase === 'running' && (
                  <View style={{
                    alignItems: 'center', paddingVertical: 28,
                    gap: 10, marginBottom: 14,
                  }}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      Waiting for first tick…
                    </Text>
                  </View>
                )}

                {/* ── Event log ─────────────────────────────────────────── */}
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
                        <View style={{
                          width: 8, height: 8, borderRadius: 4,
                          backgroundColor: ev.color,
                        }} />
                        <Text style={{
                          color: colors.textTertiary, fontSize: 11,
                          fontWeight: '700', width: 42,
                        }}>
                          {ev.tick === 0 ? 'Entry' : `Min ${ev.tick}`}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
                          {ev.label}
                        </Text>
                      </View>
                    ))}
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
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Done</Text>
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
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>
      {items.map(({ min, desc }) => (
        <View key={min} style={{ flexDirection: 'row', gap: 8, marginBottom: 5 }}>
          <Text style={{
            color: accentColor, fontSize: 11, fontWeight: '700', width: 48,
          }}>
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

function TickTimeline({
  currentTick, scenario, colors,
}: { currentTick: number; scenario: SimScenario; colors: any }) {
  const eventTicks = scenario === 'profit' ? [3, 5, 6, 9, 10] : [4];
  const barColor   = scenario === 'profit' ? colors.success : colors.error;

  return (
    <View>
      {/* Dot row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 }}>
        {Array.from({ length: TOTAL_TICKS }, (_, i) => {
          const tick     = i + 1;
          const isPast   = tick <= currentTick;
          const isCurrent = tick === currentTick;
          const isEvent  = eventTicks.includes(tick);
          const dotColor = isPast ? barColor : colors.border;

          return (
            <View key={tick} style={{ flex: 1, alignItems: 'center' }}>
              {isEvent && (
                <Text style={{
                  color: colors.textTertiary, fontSize: 8, marginBottom: 2,
                }}>
                  {tick}m
                </Text>
              )}
              <View style={{
                width:  isCurrent ? 11 : (isEvent ? 9 : 6),
                height: isCurrent ? 11 : (isEvent ? 9 : 6),
                borderRadius: 6,
                backgroundColor: isCurrent ? '#FFD60A' : dotColor,
              }} />
            </View>
          );
        })}
      </View>

      {/* Progress bar */}
      <View style={{
        height: 3, borderRadius: 2,
        backgroundColor: colors.border,
        overflow: 'hidden', marginBottom: 16,
      }}>
        <View style={{
          height: '100%', borderRadius: 2,
          width: `${(currentTick / TOTAL_TICKS) * 100}%`,
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
