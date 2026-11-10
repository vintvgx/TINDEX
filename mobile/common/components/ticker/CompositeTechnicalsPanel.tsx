import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CompositeScore, EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { useStrategyConfigs } from '@/hooks/queries/strategy/useStrategyConfigs';
import { useUpdateStrategyConfig } from '@/hooks/mutations/strategy/useUpdateStrategyConfig';
import { useToast } from '@/common/components/ui/Toast';
import { GATE_MODES, GateModePicker, gateModeOf } from '@/common/components/strategy/GateModePicker';
import type { StrategyConfig, TechnicalsGateMode } from '@/common/types/strategy';
import { chartComposite, fmtScore, isEnterTier, scoreColor, tierMeta } from './compositeMeta';

/**
 * Composite Technicals detail sheet (TODO 9e09ca2f, Muse's mock
 * tindex-technicals-ui-mock.html, redesigned 2026-11-10): the strip above
 * the chart shows one pill only, so THIS sheet carries everything —
 * a readable focus line (ticker · strategy · side · updated), both sides
 * in full (lead side first, with the score hero), both lenses, the price
 * levels, both verdict reasons, the Gate Mode picker, and Review Entry.
 */
export function CompositeTechnicalsPanel({ check, colors, onReviewEntry, tradeSide }: {
  check: EntryCheck;
  colors: any;
  /** Open trade's side — the sheet leads with it, like the strip. */
  tradeSide?: 'CALL' | 'PUT' | null;
  /** Opens the contract chain → trade sheet (confirm-first applies there). */
  onReviewEntry?: (direction: 'CALL' | 'PUT') => void;
}) {
  const comp = chartComposite(check, tradeSide)!;
  const other = check.composite![comp.direction === 'CALL' ? 'PUT' : 'CALL'];
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
  const sideColor = comp.direction === 'CALL' ? colors.success : colors.error;

  return (
    <View style={{ gap: 16 }}>
      {/* Focus — the line the strip crowds out: ticker, strategy, the side
          this sheet leads with, and when the read was taken. */}
      <View>
        <Text style={[s.focus, { color: colors.text }]}>
          {check.ticker}
          {strategy?.profile ? <Text style={{ color: muted }}> · {strategy.profile}</Text> : null}
          <Text style={{ color: sideColor }}> · {comp.direction}</Text>
        </Text>
        <Text style={[s.focusSub, { color: muted }]}>
          {check.market_open ? 'Updated' : 'Closed ·'} {updated} ET · {comp.direction} {fmtScore(comp.total)} / {comp.max} · {tier.label}
        </Text>
      </View>

      {/* Lead side — score hero */}
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
      <IndicatorRows comp={comp} colors={colors} />
      <TurningBox comp={comp} colors={colors} />

      {/* Other side — same detail, no hero. The strip hides it; the sheet
          must not, or a flip (PUT +10 while CALL was leading) is invisible. */}
      <View>
        <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>OTHER SIDE</Text>
        <OtherSide comp={other} colors={colors} />
      </View>

      {/* Lenses — intraday is what the engine gates on; daily is the verdict. */}
      {check.lens ? <LensSection check={check} lead={comp.direction} colors={colors} /> : null}

      {/* Levels — the price facts behind the scores. */}
      <LevelsSection check={check} colors={colors} />

      {/* Why — both verdict reasons, with blockers. */}
      <WhySection check={check} colors={colors} />

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

function IndicatorRows({ comp, colors }: { comp: CompositeScore; colors: any }) {
  const muted = colors.textSecondary;
  return (
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
  );
}

function TurningBox({ comp, colors }: { comp: CompositeScore; colors: any }) {
  if (comp.turning.length === 0) return null;
  const muted = colors.textSecondary;
  return (
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
  );
}

function OtherSide({ comp, colors }: { comp: CompositeScore; colors: any }) {
  const tier = tierMeta(comp.tier, colors);
  const enter = isEnterTier(comp.tier);
  const sideColor = comp.direction === 'CALL' ? colors.success : colors.error;
  return (
    <View style={{ gap: 10 }}>
      <View style={s.sideHead}>
        <Text style={[s.sideName, { color: sideColor }]}>{comp.direction}</Text>
        <Text style={[s.sideTotal, { color: colors.text }]}>{fmtScore(comp.total)} / {comp.max}</Text>
        <View style={[s.tierBadge, { backgroundColor: tier.color }]}>
          <Text style={s.tierText}>{tier.label}</Text>
        </View>
      </View>
      <Text style={[s.sideState, { color: enter ? sideColor : colors.warning }]}>
        {enter ? 'Enter — passes the gate' : 'Wait — below the gate'}
      </Text>
      <ScoreBar comp={comp} colors={colors} />
      <IndicatorRows comp={comp} colors={colors} />
      <TurningBox comp={comp} colors={colors} />
      {comp.missing.length > 0 && (
        <Text style={[s.missing, { color: colors.textTertiary }]}>Missing: {comp.missing.join(', ')}</Text>
      )}
    </View>
  );
}

function LensSection({ check, lead, colors }: { check: EntryCheck; lead: 'CALL' | 'PUT'; colors: any }) {
  const lens = check.lens!;
  const muted = colors.textSecondary;
  const checks = lens.intraday.checks[lead];
  const checkItems: [string, boolean][] = [
    ['Composite', checks.composite],
    ['VWAP', checks.vwap],
    ['ORB', checks.orb],
    ['Trend', checks.trend],
  ];
  return (
    <View>
      <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>LENSES</Text>
      <View style={{ gap: 10 }}>
        <View style={[s.lensCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[s.lensTitle, { color: colors.text }]}>Intraday — what the engine gates on</Text>
          <Text style={[s.lensText, { color: muted }]}>{lens.intraday.text}</Text>
          {lens.intraday.trend_5m ? (
            <Text style={[s.lensText, { color: muted }]}>5-min trend: {lens.intraday.trend_5m}</Text>
          ) : null}
          <View style={s.checkRow}>
            {checkItems.map(([label, ok]) => (
              <View key={label} style={[s.checkChip, { borderColor: ok ? colors.success + '66' : colors.error + '66' }]}>
                <Text style={[s.checkText, { color: ok ? colors.success : colors.error }]}>
                  {ok ? '✓' : '✗'} {label}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[s.lensCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[s.lensTitle, { color: colors.text }]}>Daily — verdict</Text>
          <Text style={[s.lensText, { color: muted }]}>{lens.daily.text}</Text>
        </View>
        {!lens.agree && (
          <Text style={[s.disagree, { color: colors.warning }]}>
            Intraday and daily lenses disagree — {lens.label}
          </Text>
        )}
      </View>
    </View>
  );
}

function LevelsSection({ check, colors }: { check: EntryCheck; colors: any }) {
  const muted = colors.textSecondary;
  const { trend, rsi, vwap, orb, sector } = check.rows;
  const rows: [string, string, string?][] = [];
  if (vwap) {
    rows.push(['VWAP', `${vwap.position} (${vwap.distance_pct > 0 ? '+' : ''}${vwap.distance_pct.toFixed(2)}%)`, `$${vwap.value.toFixed(2)}`]);
  }
  if (orb) {
    rows.push(['ORB', orb.position, `High $${orb.high.toFixed(2)} · Low $${orb.low.toFixed(2)}`]);
  }
  if (trend) {
    rows.push(['Trend (daily)', trend.label,
      `EMA-20 $${trend.ema20.toFixed(2)}${trend.ema50 != null ? ` · EMA-50 $${trend.ema50.toFixed(2)}` : ''}${trend.ema200 != null ? ` · EMA-200 $${trend.ema200.toFixed(2)}` : ''}`]);
  }
  if (rsi) {
    rows.push(['RSI-14', `${rsi.value.toFixed(0)} · ${rsi.zone}`, 'Daily, Wilder-smoothed']);
  }
  if (sector && sector.label !== 'n/a') {
    const rp = sector.relative_pct;
    rows.push(['Sector', `${sector.label}${rp != null ? ` (${rp > 0 ? '+' : ''}${rp.toFixed(2)}%)` : ''}`, sector.etf ? `${sector.etf} vs SPY today` : undefined]);
  }
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>LEVELS</Text>
      {rows.map(([k, v, sub]) => (
        <View key={k} style={s.infoRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{k}</Text>
            {sub ? <Text style={{ color: muted, fontSize: 11 }}>{sub}</Text> : null}
          </View>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function WhySection({ check, colors }: { check: EntryCheck; colors: any }) {
  const muted = colors.textSecondary;
  const verdict = (d: 'CALL' | 'PUT') =>
    check.verdicts?.[d] ?? (d === 'CALL' ? check.verdict : null);
  return (
    <View>
      <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>WHY</Text>
      <View style={{ gap: 8 }}>
        {(['CALL', 'PUT'] as const).map(d => {
          const v = verdict(d);
          const sideColor = d === 'CALL' ? colors.success : colors.error;
          return (
            <View key={d} style={[s.reasonCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <Text style={[s.reasonSide, { color: sideColor }]}>
                {d === 'CALL' ? 'Call' : 'Put'}
                {v ? <Text style={{ color: muted, fontWeight: '600' }}> · {v.decision} · {v.factors_agree}/{v.factors_total} factors</Text> : null}
              </Text>
              <Text style={[s.reasonText, { color: muted }]}>
                {v?.reason ?? 'Update the API to see this side'}
              </Text>
              {v && v.blockers.length > 0 ? (
                <Text style={[s.reasonText, { color: colors.warning }]}>Blocked by: {v.blockers.join(', ')}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
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
        <Text style={[s.barLabel, { color: colors.textTertiary }]}>-{comp.max} Against</Text>
        <Text style={[s.barLabel, { color: colors.textTertiary }]}>0 Neutral</Text>
        <Text style={[s.barLabel, { color: colors.textTertiary }]}>+{comp.max} Favors {comp.direction}</Text>
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
  focus:       { fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  focusSub:    { fontSize: 12, marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
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
  sideHead:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sideName:    { fontSize: 17, fontWeight: '800' },
  sideTotal:   { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sideState:   { fontSize: 12, fontWeight: '700' },
  missing:     { fontSize: 11.5, lineHeight: 15 },
  lensCard:    { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  lensTitle:   { fontSize: 13, fontWeight: '700' },
  lensText:    { fontSize: 12, lineHeight: 16 },
  checkRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  checkChip:   { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  checkText:   { fontSize: 11, fontWeight: '700' },
  disagree:    { fontSize: 12, lineHeight: 16 },
  infoRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  reasonCard:  { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  reasonSide:  { fontSize: 12, fontWeight: '800' },
  reasonText:  { fontSize: 12, lineHeight: 16 },
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
