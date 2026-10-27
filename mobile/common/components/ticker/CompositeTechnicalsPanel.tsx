import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CompositeScore, EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { useStrategyConfigs } from '@/hooks/queries/strategy/useStrategyConfigs';
import { useUpdateStrategyConfig } from '@/hooks/mutations/strategy/useUpdateStrategyConfig';
import { useToast } from '@/common/components/ui/Toast';
import { GATE_MODES, GateModePicker, gateModeOf } from '@/common/components/strategy/GateModePicker';
import type { StrategyConfig, TechnicalsGateMode } from '@/common/types/strategy';
import { chartComposite, fmtScore, scoreColor, tierMeta } from './compositeMeta';

/**
 * Composite Technicals detail sheet (TODO 9e09ca2f, Muse's mock
 * tindex-technicals-ui-mock.html): score hero + tier, -14..+14 bar, every
 * indicator with a mini score bar, turning signals with their caveats, the
 * Gate Mode picker for this ticker's strategy, and Review Entry.
 */
export function CompositeTechnicalsPanel({ check, colors, onReviewEntry }: {
  check: EntryCheck;
  colors: any;
  /** Opens the contract chain → trade sheet (confirm-first applies there). */
  onReviewEntry?: (direction: 'CALL' | 'PUT') => void;
}) {
  const comp = chartComposite(check)!;
  const tier = tierMeta(comp.tier, colors);
  const muted = colors.textSecondary;
  const configs = useStrategyConfigs();
  const strategies = useMemo(
    () => (configs.data ?? []).filter(c => c.ticker?.toUpperCase() === check.ticker.toUpperCase()),
    [configs.data, check.ticker],
  );
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const strategy = strategies.find(c => c.id === strategyId) ?? strategies[0] ?? null;

  const updated = formatTime(check.as_of);
  const subtitle = [check.ticker, strategy?.profile, comp.direction, `${check.market_open ? 'Updated' : 'Closed ·'} ${updated} ET`]
    .filter(Boolean).join(' • ');

  return (
    <View style={{ gap: 16 }}>
      <Text style={[s.subtitle, { color: muted }]}>{subtitle}</Text>

      {/* Score hero */}
      <LinearGradient
        colors={[tier.color + '26', tier.color + '0D']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.hero, { borderColor: tier.color + '44' }]}
      >
        <Text>
          <Text style={[s.heroNum, { color: tier.color }]}>{fmtScore(comp.total)}</Text>
          <Text style={[s.heroMax, { color: muted }]}>  / {comp.max}</Text>
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={[s.tierBadge, { backgroundColor: tier.color }]}>
            <Text style={s.tierText}>{tier.label}</Text>
          </View>
          <Text style={[s.tierSub, { color: muted }]}>{tier.sub}</Text>
        </View>
      </LinearGradient>

      <ScoreBar comp={comp} colors={colors} />

      {/* Indicators */}
      <View>
        {comp.indicators.map((ind, i) => {
          const c = scoreColor(ind.score, colors);
          const w = ind.score ? `${(Math.abs(ind.score) / 2) * 50}%` : '0%';
          return (
            <View key={ind.key} style={[s.row, i < comp.indicators.length - 1 && { borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <View style={[s.rowDot, { backgroundColor: c }]} />
              <View style={{ flex: 1 }}>
                <Text style={[s.rowName, { color: colors.text }]}>
                  {ind.label}{ind.key === 'rsi_intraday' ? ' (5-min)' : ''}
                </Text>
                <Text style={[s.rowValue, { color: muted }]}>{ind.detail}</Text>
              </View>
              <View style={[s.miniBar, { backgroundColor: colors.surfaceSecondary }]}>
                {ind.score ? (
                  <View style={[s.miniFill, { width: w as any, backgroundColor: c },
                    ind.score > 0 ? { left: '50%' } : { right: '50%' }]} />
                ) : null}
              </View>
              <Text style={[s.rowScore, { color: c }]}>{ind.score == null ? '—' : fmtScore(ind.score)}</Text>
            </View>
          );
        })}
      </View>

      {/* Turning signals */}
      {comp.turning.length > 0 && (
        <View style={[s.turning, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[s.turningTitle, { color: colors.warning }]}>⚡ Turning Signals Detected</Text>
          {comp.turning.map((t, i) => (
            <View key={i} style={s.turningItem}>
              <Text style={[s.turningIcon, { color: t.kind === 'caveat' ? colors.warning : colors.success }]}>
                {t.kind === 'caveat' ? '⚠' : comp.direction === 'CALL' ? '↗' : '↘'}
              </Text>
              <Text style={[s.turningText, { color: colors.text }]}>
                <Text style={{ fontWeight: '700' }}>{t.title}: </Text>
                <Text style={{ color: muted }}>{t.text}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}

      <GateModeSection
        strategies={strategies}
        strategy={strategy}
        loading={configs.isLoading}
        loadFailed={configs.isError}
        onSelectStrategy={setStrategyId}
        colors={colors}
      />

      {onReviewEntry && (
        <View>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onReviewEntry(comp.direction)}
            style={[s.action, { backgroundColor: comp.direction === 'CALL' ? colors.success : colors.error }]}
          >
            <Text style={s.actionText}>Review {comp.direction} Entry →</Text>
          </TouchableOpacity>
          <Text style={[s.actionSub, { color: colors.textTertiary }]}>Confirm-first applies • Paper by default</Text>
        </View>
      )}
    </View>
  );
}

function ScoreBar({ comp, colors }: { comp: CompositeScore; colors: any }) {
  const pct = (Math.min(Math.abs(comp.total), comp.max) / comp.max) * 50;
  const c = scoreColor(comp.total, colors);
  return (
    <View>
      <View style={[s.bar, { backgroundColor: colors.surfaceSecondary }]}>
        {comp.total !== 0 && (
          <View style={[s.barFill, { width: `${pct}%`, backgroundColor: c },
            comp.total > 0 ? { left: '50%', borderTopRightRadius: 4, borderBottomRightRadius: 4 }
              : { right: '50%', borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }]} />
        )}
        <View style={[s.barCenter, { backgroundColor: colors.textTertiary }]} />
      </View>
      <View style={s.barLabels}>
        <Text style={[s.barLabel, { color: colors.textTertiary }]}>-{comp.max} Bearish</Text>
        <Text style={[s.barLabel, { color: colors.textTertiary }]}>0 Neutral</Text>
        <Text style={[s.barLabel, { color: colors.textTertiary }]}>+{comp.max} Bullish</Text>
      </View>
    </View>
  );
}

/**
 * Gate Mode for the strategy trading this ticker. Saving PATCHes that
 * strategy's technicals_gate.mode (the engine hot-reloads). Score only
 * appears when the strategy already uses it — it's set in the editor.
 */
function GateModeSection({ strategies, strategy, loading, loadFailed, onSelectStrategy, colors }: {
  strategies: StrategyConfig[];
  strategy: StrategyConfig | null;
  loading: boolean;
  /** The strategies query failed — distinct from loading and from a successful empty result. */
  loadFailed?: boolean;
  onSelectStrategy: (id: string) => void;
  colors: any;
}) {
  const update = useUpdateStrategyConfig();
  const toast = useToast();
  const muted = colors.textSecondary;
  const gate = strategy?.technicals_gate ?? null;
  const mode = gateModeOf(gate, strategy?.profile);

  const setMode = (m: TechnicalsGateMode) => {
    if (!strategy) return;
    update.mutate(
      { id: strategy.id, technicals_gate: { enabled: gate?.enabled ?? false, required: gate?.required ?? [], ...gate, mode: m } },
      {
        onSuccess: () => toast.success(`${strategy.strategy_name || strategy.profile} gate → ${GATE_MODES.find(x => x.key === m)?.label}`),
        onError: e => toast.error(e instanceof Error ? e.message : 'Failed to update gate mode'),
      },
    );
  };

  return (
    <View>
      <View style={s.gateHead}>
        <Text style={[s.gateLabel, { color: muted }]}>Gate Mode</Text>
        {update.isPending && <ActivityIndicator size="small" color={muted} />}
      </View>
      {strategies.length > 1 && (
        <View style={s.stratRow}>
          {strategies.map(c => {
            const on = c.id === strategy?.id;
            return (
              <TouchableOpacity key={c.id} onPress={() => onSelectStrategy(c.id)}
                style={[s.stratChip, { borderColor: on ? colors.success : colors.separator }]}>
                <Text style={[s.stratText, { color: on ? colors.text : muted }]} numberOfLines={1}>
                  {c.strategy_name || c.profile}{c.paper_mode ? '' : ' · LIVE'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {strategy ? (
        <>
          <GateModePicker
            value={mode}
            onChange={setMode}
            colors={colors}
            disabled={update.isPending}
            modes={mode === 'composite' ? GATE_MODES : GATE_MODES.filter(m => m.key !== 'composite')}
          />
          {!gate?.enabled && (
            <Text style={[s.gateWarn, { color: colors.warning }]}>
              The technicals gate is off for this strategy — the mode applies once you turn it on in the strategy editor.
            </Text>
          )}
        </>
      ) : (
        <Text style={[s.gateWarn, { color: loadFailed ? colors.error : muted }]}>
          {loading
            ? 'Loading strategies…'
            : loadFailed
              ? 'Couldn’t load strategies — check your connection and try again.'
              : 'No strategy trades this ticker — pick a gate mode when you create one.'}
        </Text>
      )}
    </View>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return iso;
  }
}

const s = StyleSheet.create({
  subtitle:    { fontSize: 12, marginTop: -6 },
  hero:        { borderRadius: 16, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroNum:     { fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroMax:     { fontSize: 16, fontWeight: '600' },
  tierBadge:   { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  tierText:    { color: '#000', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  tierSub:     { fontSize: 12, marginTop: 6 },
  bar:         { height: 8, borderRadius: 4, overflow: 'hidden', position: 'relative' },
  barFill:     { position: 'absolute', top: 0, bottom: 0 },
  barCenter:   { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, marginLeft: -1 },
  barLabels:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  barLabel:    { fontSize: 10 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowDot:      { width: 8, height: 8, borderRadius: 4 },
  rowName:     { fontSize: 14, fontWeight: '600' },
  rowValue:    { fontSize: 12, marginTop: 1 },
  miniBar:     { width: 60, height: 5, borderRadius: 3, overflow: 'hidden', position: 'relative' },
  miniFill:    { position: 'absolute', top: 0, bottom: 0, borderRadius: 3 },
  rowScore:    { width: 36, textAlign: 'right', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  turning:     { borderRadius: 12, padding: 14, gap: 8 },
  turningTitle: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  turningItem: { flexDirection: 'row', gap: 8 },
  turningIcon: { fontSize: 13, lineHeight: 18 },
  turningText: { flex: 1, fontSize: 13, lineHeight: 18 },
  gateHead:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  gateLabel:   { fontSize: 13, fontWeight: '600' },
  gateWarn:    { fontSize: 11.5, marginTop: 6, lineHeight: 15 },
  stratRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  stratChip:   { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 180 },
  stratText:   { fontSize: 12, fontWeight: '600' },
  action:      { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionText:  { color: '#000', fontSize: 15, fontWeight: '700' },
  actionSub:   { textAlign: 'center', fontSize: 11, marginTop: 8 },
});