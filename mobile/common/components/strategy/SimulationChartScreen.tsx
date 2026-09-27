import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useSimulationRunner } from '@/hooks/useSimulationRunner';
import { useStrategyProfiles } from '@/hooks/queries/strategy/useStrategyProfiles';
import type { SimScenario, SimProfileKey } from '@/hooks/mutations/strategy/useRunSimulation';
import type { TickerHistoryData } from '@/common/types/blogPosts/ticker';
import {
  AdvancedPriceChart, type ChartReferenceLine, type ChartEventMarker,
} from '@/common/components/ticker/AdvancedPriceChart';
import { SimProfilePicker } from '@/common/components/strategy/SimProfilePicker';
import {
  ScenarioLabel, ScenarioCard, LegBadge, TickTimeline, Stat, LevelPill, scenarioLabel,
} from '@/common/components/strategy/SimulationModal';

interface Props {
  /** Called when the user taps back — pass router.back() from the route
   *  file that hosts this screen. */
  onClose: () => void;
}

const DEFAULT_PROFILE: SimProfileKey = 'THUNDER_CAT';

/**
 * Standalone IWM simulation — reached via the Menu tab's "Run Simulation"
 * row (see app/(app)/(tabs)/simulation.tsx, which pushes this as a normal
 * screen), not nested under a saved strategy config. Shares the phase/tick/
 * event-log state machine with the bottom-sheet SimulationModal via
 * useSimulationRunner, but adds: a profile picker (SimProfilePicker),
 * profile-relative scenario previews, and a live AdvancedPriceChart showing
 * candles building tick-by-tick with entry/TP1/TP2/stop reference lines and
 * markers at the exact bar each fired.
 *
 * Always passes suppress_push: true — this entry point requires no
 * pre-existing strategy, and push notifications aren't scoped to a user
 * (they'd otherwise broadcast to every opted-in user app-wide).
 */
export function SimulationChartScreen({ onClose }: Props) {
  const colors = useThemeColors();
  const { data: allProfiles } = useStrategyProfiles();

  const [chartProfile, setChartProfile] = useState<SimProfileKey>(DEFAULT_PROFILE);
  const [bars, setBars] = useState<TickerHistoryData | null>(null);
  const lastAppendedTickRef = useRef(0);

  const {
    phase, scenario, events, markers, elapsed, currentTick, totalTicks,
    simLeg, callPnl, displayLive, simResult, isPending, handleStart, handleClose,
  } = useSimulationRunner({ suppressPush: true });

  // Seed the chart's bar array once the POST response lands — from there,
  // one real closed bar gets appended per WS tick (see the effect below),
  // rather than blending into a single last bar the way the live-ticker
  // chart does (AdvancedPriceChart's livePrice mode). Each tick — and every
  // TP1/TP2/stop event — needs its own distinct, addressable bar so markers
  // land on the exact bar where they fired.
  useEffect(() => {
    if (simResult) setBars(simResult.history);
  }, [simResult]);

  // Append one bar per WS tick. Guarded by lastAppendedTickRef so a re-render
  // with the same displayLive value (no new tick) never double-appends.
  useEffect(() => {
    if (!displayLive || displayLive.underlying_price == null || displayLive.sim_tick == null) return;
    if (displayLive.sim_tick === lastAppendedTickRef.current) return;
    lastAppendedTickRef.current = displayLive.sim_tick;

    setBars(prev => {
      if (!prev || prev.prices.length === 0) return prev;
      const open  = prev.prices[prev.prices.length - 1];
      const close = displayLive.underlying_price!;
      const pad   = Math.abs(close - open) * 0.15 + 0.02;
      const lastDate = new Date(prev.dates[prev.dates.length - 1]);
      const nextDate = new Date(lastDate.getTime() + 5 * 60 * 1000).toISOString();
      return {
        dates:   [...prev.dates, nextDate],
        prices:  [...prev.prices, close],
        volumes: [...prev.volumes, 20_000],
        opens:   [...(prev.opens ?? []), open],
        highs:   [...(prev.highs ?? []), Math.max(open, close) + pad],
        lows:    [...(prev.lows ?? []), Math.min(open, close) - pad],
      };
    });
  }, [displayLive]);

  const startSimulation = (chosen: SimScenario) => {
    setBars(null);
    lastAppendedTickRef.current = 0;
    handleStart(chosen, chartProfile);
  };

  const resetToPick = () => {
    handleClose();
    setBars(null);
    lastAppendedTickRef.current = 0;
  };

  const closeAndReset = () => {
    resetToPick();
    onClose();
  };

  // ── Chart annotations ──────────────────────────────────────────────────────

  const referenceLines: ChartReferenceLine[] = [];
  if (displayLive) {
    if (displayLive.entry_underlying != null) {
      referenceLines.push({ label: 'Entry', price: displayLive.entry_underlying, color: colors.textSecondary, dash: '2,3' });
    }
    if (displayLive.tp1_underlying != null) {
      referenceLines.push({ label: 'TP1', price: displayLive.tp1_underlying, color: colors.success });
    }
    if (displayLive.tp2_underlying != null) {
      referenceLines.push({ label: 'TP2', price: displayLive.tp2_underlying, color: colors.success, dash: '3,3' });
    }
    if (displayLive.stop_underlying != null) {
      referenceLines.push({ label: 'Stop', price: displayLive.stop_underlying, color: colors.error });
    }
  }

  // simResult.history's bar count is where tick 1 lands — computed straight
  // from the (already-reactive) simResult, not a ref, so it can never lag a
  // render behind the markers array the way a ref set in a separate effect
  // would for one frame.
  const initialBarCount = simResult?.history.dates.length ?? 0;
  const eventMarkers: ChartEventMarker[] = bars
    ? markers
        .map(m => ({
          index: m.tick === 0 ? initialBarCount - 1 : initialBarCount + m.tick - 1,
          price: m.price,
          label: m.label,
          color: m.color,
        }))
        .filter(m => m.index >= 0 && m.index < bars.dates.length)
    : [];

  const activeProfile = (allProfiles ?? []).find(p => p.key === chartProfile);

  const profitPreview = activeProfile ? [
    { min: 'Tick 3',  desc: `TP1 crosses — first partial close (+${activeProfile.tp1_pct}%)` },
    { min: 'Tick 4',  desc: 'TP1 confirmed — stop moves to breakeven' },
    ...(activeProfile.use_tp2
      ? [{ min: 'Tick 6', desc: `TP2 crosses — runner continues (+${activeProfile.tp2_pct}%)` }]
      : []),
    { min: 'Tick 9',  desc: 'Runner peaks' },
    {
      min: 'Tick 10',
      desc: activeProfile.runner_mode === 'be_hold'
        ? 'Reverses to breakeven stop — fully closed'
        : 'Trailing stop fires — fully closed',
    },
  ] : [];

  const lossPreview = activeProfile ? [
    { min: 'Tick 1',   desc: 'Price begins declining' },
    { min: 'Tick 2–3', desc: `Continues lower, approaching stop (−${activeProfile.max_loss_pct}%)` },
    { min: 'Tick 4',   desc: `Hard stop hit — full close (−${activeProfile.max_loss_pct}%)` },
  ] : [];

  const reversalPreview = activeProfile ? [
    { min: 'Tick 1–3', desc: 'CALL entered, price declines toward stop' },
    { min: 'Tick 4',   desc: `Hard stop triggered — CALL exits (−${activeProfile.max_loss_pct}%)` },
    { min: 'Tick 4',   desc: 'Reversal detected → PUT entered' },
    { min: 'Tick 7',   desc: `TP1 hit on PUT (+${activeProfile.tp1_pct}%)` },
    { min: 'Tick 16',  desc: 'Runner closes — net P&L shown' },
  ] : [];

  const pnl      = displayLive?.pnl ?? 0;
  const netPnl   = scenario === 'reversal' && simLeg === 'put' ? callPnl + pnl : pnl;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const netColor = netPnl >= 0 ? colors.success : colors.error;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
          <Pressable onPress={closeAndReset} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>IWM Simulation</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
              {phase === 'pick' ? 'Pick a profile & scenario' : `${scenarioLabel(scenario!)}${phase === 'done' ? ' — Complete' : '…'}`}
            </Text>
          </View>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
        >
          {phase === 'pick' && (
            <>
              <ScenarioLabel colors={colors} text="Exit Profile" />
              <View style={{ marginBottom: 20 }}>
                <SimProfilePicker selectedKey={chartProfile} onSelect={setChartProfile} colors={colors} />
              </View>

              <ScenarioLabel colors={colors} text="Choose a Scenario" />

              <ScenarioCard
                emoji="📈"
                title="Profitable Trade"
                subtitle={activeProfile ? `TP1 → ${activeProfile.use_tp2 ? 'TP2 → ' : ''}runner` : 'Loading…'}
                accentColor={colors.success}
                items={profitPreview}
                disabled={isPending || !activeProfile}
                colors={colors}
                onPress={() => startSimulation('profit')}
              />

              <ScenarioCard
                emoji="📉"
                title="Stopped Out"
                subtitle={activeProfile ? `Hard stop @ −${activeProfile.max_loss_pct}%` : 'Loading…'}
                accentColor={colors.error}
                items={lossPreview}
                disabled={isPending || !activeProfile}
                colors={colors}
                onPress={() => startSimulation('loss')}
              />

              <ScenarioCard
                emoji="🔄"
                title="Call Fails → Reversal PUT"
                subtitle="CALL stops out, PUT runs the profit sequence"
                accentColor="#FF9F0A"
                items={reversalPreview}
                disabled={isPending || !activeProfile}
                colors={colors}
                onPress={() => startSimulation('reversal')}
              />

              <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: 10 }}>
                Each simulated tick takes 6 real seconds. In-app only — no push notifications fire.
              </Text>
            </>
          )}

          {(phase === 'running' || phase === 'done') && (
            <>
              {/* Status row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {phase === 'running' ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textTertiary }} />
                )}
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 }}>
                  {activeProfile?.display_name ?? chartProfile} — {phase === 'done' ? `${scenarioLabel(scenario!)} Complete` : `${scenarioLabel(scenario!)} Running…`}
                </Text>
                {phase === 'running' && (
                  <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{elapsed}s</Text>
                )}
              </View>

              {scenario === 'reversal' && phase === 'running' && (
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <LegBadge label="CALL" active={simLeg === 'call'} done={simLeg === 'put'} colors={colors} />
                  <LegBadge label="PUT" active={simLeg === 'put'} done={false} colors={colors} />
                </View>
              )}

              {/* Live chart — candles build one per tick, ORB band + entry/TP/stop
                  reference lines + markers where each event actually fired. */}
              <View style={{ marginBottom: 14 }}>
                <AdvancedPriceChart
                  data={bars ?? undefined}
                  isLoading={!bars}
                  period="1D"
                  onPeriodChange={() => {}}
                  positive={pnl >= 0}
                  height={280}
                  orbRange={simResult ? { high: simResult.orb_high, low: simResult.orb_low } : null}
                  showOrbRange
                  referenceLines={referenceLines}
                  eventMarkers={eventMarkers}
                />
              </View>

              <TickTimeline
                currentTick={currentTick}
                totalTicks={totalTicks}
                scenario={scenario!}
                simLeg={scenario === 'reversal' ? simLeg : undefined}
                colors={colors}
              />

              {displayLive ? (
                <View style={{
                  backgroundColor: colors.surfaceSecondary,
                  borderRadius: 16, padding: 16, marginTop: 6, marginBottom: 14,
                  borderWidth: 1.5, borderColor: pnlColor + '40',
                }}>
                  <View style={{
                    position: 'absolute', top: 10, right: 10,
                    backgroundColor: colors.accent + '22',
                    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
                  }}>
                    <Text style={{ color: colors.accent, fontSize: 9, fontWeight: '800' }}>SIM</Text>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 }}>
                    <Stat label="IWM Price" value={`$${(displayLive.underlying_price ?? 0).toFixed(2)}`} color={colors.text} />
                    <Stat label="P&L" value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`} color={pnlColor} />
                    <Stat label="Change" value={`${displayLive.pnl_pct >= 0 ? '+' : ''}${displayLive.pnl_pct.toFixed(0)}%`} color={pnlColor} />
                    <Stat label="Qty" value={String(displayLive.qty_remaining)} color={colors.text} />
                  </View>

                  {scenario === 'reversal' && simLeg === 'put' && (
                    <View style={{
                      flexDirection: 'row', justifyContent: 'space-between',
                      borderTopWidth: 1, borderTopColor: colors.border,
                      paddingTop: 10, marginBottom: 12,
                    }}>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', marginBottom: 3 }}>CALL P&L</Text>
                        <Text style={{ color: colors.error, fontSize: 14, fontWeight: '700' }}>${callPnl.toFixed(2)}</Text>
                      </View>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', marginBottom: 3 }}>PUT P&L</Text>
                        <Text style={{ color: pnlColor, fontSize: 14, fontWeight: '700' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</Text>
                      </View>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600', marginBottom: 3 }}>NET</Text>
                        <Text style={{ color: netColor, fontSize: 14, fontWeight: '800' }}>{netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}</Text>
                      </View>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <LevelPill label="TP1" value={`$${displayLive.tp1.toFixed(2)}`} hit={displayLive.tp1_hit} colors={colors} />
                    <LevelPill label="TP2" value={`$${displayLive.tp2.toFixed(2)}`} hit={displayLive.tp2_hit} colors={colors} />
                    <LevelPill label="STOP" value={`$${displayLive.hard_stop.toFixed(2)}`} isStop colors={colors} />
                  </View>
                </View>
              ) : phase === 'running' && (
                <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10, marginBottom: 14 }}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Waiting for first tick…</Text>
                </View>
              )}

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
                      <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', width: 46 }}>
                        {ev.tick === 0 ? 'Entry' : `Tick ${ev.tick}`}
                      </Text>
                      <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{ev.label}</Text>
                    </View>
                  ))}
                </View>
              )}

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
                  onPress={resetToPick}
                  style={{
                    backgroundColor: colors.accent,
                    borderRadius: 14, paddingVertical: 14,
                    alignItems: 'center', marginTop: 6,
                  }}
                >
                  <Text style={{ color: colors.accentForeground, fontSize: 15, fontWeight: '700' }}>
                    Run Another
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
    </SafeAreaView>
  );
}
