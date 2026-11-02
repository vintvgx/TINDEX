// Trade Detail v2 (trade-logging-cascade-v2 brief §5) — the expanded body of
// a Trade Log card. Renders buildTradeDetailVM's output only; every value
// shows its provenance badge, and anything not logged reads MISSING.

import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { ORBTrade } from '@/common/types/strategy';
import type { PField, Provenance } from '@/common/types/tradeLogV2';
import { PROVENANCE_ORDER } from '@/common/types/tradeLogV2';
import { buildTradeDetailVM, fmtMoney, type VMLeg, type VMRow } from '@/lib/tradeLogV2';

const PROV_STYLE: Record<Provenance, { fg: string; bg: string }> = {
  VERIFIED:   { fg: '#30D158', bg: 'rgba(48,209,88,0.15)' },
  ENGINE:     { fg: '#7AB8FF', bg: 'rgba(122,184,255,0.15)' },
  INFERRED:   { fg: '#F5A623', bg: 'rgba(245,166,35,0.15)' },
  MANUAL:     { fg: '#C9A7FF', bg: 'rgba(201,167,255,0.15)' },
  UNVERIFIED: { fg: '#FF8FC4', bg: 'rgba(255,143,196,0.15)' },
  STALE:      { fg: '#A3A9B3', bg: 'rgba(163,169,179,0.15)' },
  MISSING:    { fg: '#FF7A7A', bg: 'rgba(255,122,122,0.15)' },
  ESTIMATE:   { fg: '#5FD4D4', bg: 'rgba(95,212,212,0.15)' },
};

const PROV_DEF: Record<Provenance, string> = {
  VERIFIED:   'Broker/API fill, or engine log written at decision time.',
  ENGINE:     'Computed by the system at decision time from live inputs.',
  INFERRED:   'Reconstructed after the fact. Basis shown. Never a fill.',
  MANUAL:     'Entered or overridden by a person (who, when, via what).',
  UNVERIFIED: 'Present but not checked.',
  STALE:      'Present but known stale (e.g. volume/OI reading 0).',
  MISSING:    'The system did not log it. Shown as a gap, never filled.',
  ESTIMATE:   'Derived (e.g. intrinsic from underlying), not a quoted premium.',
};

export const ProvBadge = ({ p }: { p: Provenance }) => {
  const s = PROV_STYLE[p] ?? PROV_STYLE.MISSING;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.fg }]}>{p}</Text>
    </View>
  );
};

const FieldValue = ({ f, colors, align = 'right' }: { f: PField<string>; colors: any; align?: 'left' | 'right' }) => (
  <View style={{ flexShrink: 1, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
    <View style={styles.valueLine}>
      <Text style={[styles.value, { color: f.v == null ? colors.tabBarInactive : colors.text, textAlign: align }]} selectable>
        {f.v ?? '—'}
      </Text>
      <ProvBadge p={f.p} />
    </View>
    {!!f.basis && <Text style={[styles.basis, { color: colors.tabBarInactive, textAlign: align }]}>{f.basis}</Text>}
  </View>
);

const Row = ({ row, colors }: { row: VMRow; colors: any }) => (
  <View style={[styles.row, { borderBottomColor: colors.border }]}>
    <Text style={[styles.label, { color: colors.tabBarInactive }]}>{row.label}</Text>
    <FieldValue f={row.field} colors={colors} />
  </View>
);

const Header = ({ title, colors }: { title: string; colors: any }) => (
  <Text style={[styles.section, { color: colors.tabBarInactive }]}>{title}</Text>
);

const LEG_DOT: Record<VMLeg['kind'], (c: any) => string> = {
  entry: c => c.tabBarInactive, exit: c => c.success, candidate: () => '#7AB8FF',
  blocked: c => c.warning, missing: c => c.error, other: c => c.border,
};

const Leg = ({ leg, colors }: { leg: VMLeg; colors: any }) => (
  <View style={styles.leg}>
    <View style={[styles.dot, { backgroundColor: LEG_DOT[leg.kind](colors), borderColor: colors.card }]} />
    <View style={styles.legHead}>
      <Text style={[styles.legTime, { color: colors.tabBarInactive }]}>{leg.time ? `${leg.time} ET` : 'time not logged'}</Text>
      <Text style={[styles.legTitle, { color: colors.text }]}>{leg.title}</Text>
      <Text style={[styles.mono, { color: colors.text }]}>{leg.qtyText}</Text>
      <ProvBadge p={leg.p} />
    </View>
    <Text style={[styles.legMeta, { color: colors.tabBarInactive }]}>
      {[
        leg.qtyFlow ? `qty ${leg.qtyFlow}` : null,
        leg.legPnl != null ? `leg ${fmtMoney(leg.legPnl)}` : null,
        leg.kind !== 'entry' ? `cum ${fmtMoney(leg.cumPnl)}` : null,
        leg.underlying ? `underlying ${leg.underlying}` : leg.kind === 'exit' ? 'underlying —' : null,
      ].filter(Boolean).join('  ·  ')}
    </Text>
    {!!leg.basis && <Text style={[styles.basis, { color: colors.tabBarInactive }]}>Basis: {leg.basis}</Text>}
    {!!leg.evidence && <Text style={[styles.note, { color: colors.text, backgroundColor: colors.background }]}>{leg.evidence}</Text>}
    {leg.bars.length > 0 && (
      <View style={styles.bars}>
        {leg.bars.map((b, i) => (
          <Text key={i} style={[styles.bar, {
            color: b.kind === 'against' ? colors.warning : colors.tabBarInactive,
            borderColor: b.kind === 'against' ? colors.warning : colors.border,
            borderStyle: b.kind === 'doji' ? 'dashed' : 'solid',
          }]}>
            {b.label} {b.kind === 'against' ? 'against' : b.kind === 'recovering' ? 'reset' : 'doji'}
          </Text>
        ))}
      </View>
    )}
    {!!leg.blocked && (
      <Text style={[styles.note, { color: colors.text, backgroundColor: colors.background }]}>
        <Text style={{ color: colors.warning }}>Why blocked: </Text>{leg.blocked}
      </Text>
    )}
    {!!leg.manual && <Text style={[styles.basis, { color: colors.tabBarInactive }]}>Manual: {leg.manual}</Text>}
    {leg.kind !== 'entry' && leg.kind !== 'missing' && (
      <View style={styles.techLine}>
        <Text style={[styles.basis, { color: colors.tabBarInactive }]}>Technicals: </Text>
        <FieldValue f={leg.technicals} colors={colors} align="left" />
      </View>
    )}
  </View>
);

const Collapsible = ({ title, colors, children }: { title: string; colors: any; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.collapse, { borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={[styles.collapseTitle, { color: colors.text }]}>{open ? '▾' : '▸'} {title}</Text>
      </TouchableOpacity>
      {open && <View style={{ paddingBottom: 6 }}>{children}</View>}
    </View>
  );
};

export function TradeDetailV2({ trade, dayTrades, colors }: { trade: ORBTrade; dayTrades?: ORBTrade[]; colors: any }) {
  const vm = useMemo(() => buildTradeDetailVM(trade, dayTrades ?? []), [trade, dayTrades]);
  const pnlColor = vm.pnlValue == null ? colors.text : vm.pnlValue > 0 ? colors.success : vm.pnlValue < 0 ? colors.error : colors.text;

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      {/* Outcome banner — final state, never a mid-trade partial */}
      <View style={styles.bannerTop}>
        <Text style={[styles.headline, { color: colors.text, backgroundColor: colors.background }]}>{vm.headline}</Text>
        {vm.badges.map(b => (
          <Text key={b.text} style={[styles.flag, {
            color: b.tone === 'warn' ? colors.warning : b.tone === 'error' ? colors.error : colors.tabBarInactive,
            borderColor: b.tone === 'warn' ? colors.warning : b.tone === 'error' ? colors.error : colors.border,
          }]}>{b.text}</Text>
        ))}
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.tabBarInactive }]}>{vm.pnlLabel}</Text>
        <View style={[styles.valueLine, { flexShrink: 1 }]}>
          <Text style={[styles.pnl, { color: pnlColor }]} selectable>{vm.pnl.v ?? '—'}</Text>
          <ProvBadge p={vm.pnl.p} />
        </View>
      </View>
      {vm.unrealized && <Row row={{ label: 'Unrealized (remaining)', field: vm.unrealized }} colors={colors} />}
      <Text style={[styles.legMeta, { color: colors.tabBarInactive, marginBottom: 6 }]}>
        {vm.timesText}{vm.durationText ? `  ·  ${vm.durationText}` : ''}  ·  {vm.qtyText}
      </Text>
      <View style={styles.tiles}>
        {([['Entry', vm.entryPremium], ['Avg exit', vm.avgExit], ['Last leg', vm.lastLeg]] as const).map(([k, f]) => (
          <View key={k} style={[styles.tile, { backgroundColor: colors.background }]}>
            <Text style={[styles.tileLabel, { color: colors.tabBarInactive }]}>{k}</Text>
            <View style={styles.valueLine}>
              <Text style={[styles.mono, { color: f.v == null ? colors.tabBarInactive : colors.text }]}>{f.v ?? '—'}</Text>
              {f.p !== 'VERIFIED' && <ProvBadge p={f.p} />}
            </View>
          </View>
        ))}
      </View>

      {vm.reentry && (
        <View style={[styles.reentry, { borderColor: colors.warning, backgroundColor: colors.warningBg ?? colors.background }]}>
          <View style={styles.valueLine}>
            <Text style={[styles.reentryTag, { color: colors.warning }]}>RE-ENTRY</Text>
            <ProvBadge p={vm.reentry.p} />
          </View>
          <Text style={[styles.value, { color: colors.text, textAlign: 'left' }]}>{vm.reentry.v}</Text>
          {!!vm.reentry.basis && <Text style={[styles.basis, { color: colors.tabBarInactive }]}>{vm.reentry.basis}</Text>}
        </View>
      )}

      <Header title="ENTRY SIGNAL" colors={colors} />
      {vm.entry.map(r => <Row key={r.label} row={r} colors={colors} />)}

      <Header title="CONFLUENCE AT ENTRY" colors={colors} />
      <Row row={{ label: 'Composite · tier', field: vm.composite.total }} colors={colors} />
      {vm.composite.rows.map(r => (
        <View key={r.factor} style={[styles.row, { borderBottomColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.tabBarInactive }]}>{r.factor}</Text>
          <Text style={[styles.mono, { color: vm.composite.missing ? colors.tabBarInactive : colors.text }]}>{r.value}   {r.score}</Text>
        </View>
      ))}

      <Header title="CONTRACT" colors={colors} />
      {vm.contract.map(r => <Row key={r.label} row={r} colors={colors} />)}
      <Collapsible title="Frozen config at entry" colors={colors}>
        {vm.config.map(r => <Row key={r.label} row={r} colors={colors} />)}
      </Collapsible>

      <Header title="LEG TIMELINE" colors={colors} />
      <View style={[styles.timeline, { borderLeftColor: colors.border }]}>
        {vm.legs.map(l => <Leg key={l.key} leg={l} colors={colors} />)}
      </View>
      {vm.cascadeNote && <Row row={{ label: 'Cascade candidates / blocks', field: vm.cascadeNote }} colors={colors} />}

      {vm.reconciliation && (
        <>
          <Header title="RECONCILIATION" colors={colors} />
          <View style={[styles.callout, {
            borderColor: vm.reconciliation.ok ? colors.success : colors.error,
            backgroundColor: vm.reconciliation.ok ? colors.successBg ?? colors.background : colors.errorBg ?? colors.background,
          }]}>
            <Text style={[styles.value, { color: colors.text, textAlign: 'left' }]}>{vm.reconciliation.text}</Text>
            {!vm.reconciliation.ok && <FieldValue f={vm.reconciliation.field} colors={colors} align="left" />}
          </View>
        </>
      )}

      <Header title="OUTCOME" colors={colors} />
      {vm.outcome.map(r => <Row key={r.label} row={r} colors={colors} />)}

      {vm.postExit.length > 0 && (
        <>
          <Header title="AFTER THE EXIT · FOR TUNING" colors={colors} />
          {vm.postExit.map(r => <Row key={r.label} row={r} colors={colors} />)}
          {vm.classification && vm.classification.length > 0 ? (
            <Collapsible title={`Computed checks (${vm.classification.length})`} colors={colors}>
              {vm.classification.map(q => (
                <Row key={q.question} row={{ label: q.question, field: { v: q.answer, p: 'ENGINE' } }} colors={colors} />
              ))}
            </Collapsible>
          ) : (
            <Row row={{ label: 'Computed checks', field: { v: null, p: 'MISSING' } }} colors={colors} />
          )}
        </>
      )}

      <Collapsible title="Provenance legend" colors={colors}>
        {PROVENANCE_ORDER.map(p => (
          <View key={p} style={styles.legendRow}>
            <ProvBadge p={p} />
            <Text style={[styles.basis, { color: colors.tabBarInactive, flex: 1, marginTop: 0 }]}>{PROV_DEF[p]}</Text>
          </View>
        ))}
      </Collapsible>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10 },
  bannerTop: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 4 },
  headline: { fontSize: 13, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  flag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pnl: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9, marginTop: 14, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  label: { fontSize: 12.5, flexShrink: 0, maxWidth: '45%' },
  valueLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 2 },
  value: { fontSize: 12.5, flexShrink: 1 },
  mono: { fontSize: 12.5, fontVariant: ['tabular-nums'], fontWeight: '600' },
  basis: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  badge: { borderRadius: 999, paddingHorizontal: 5, paddingVertical: 2, marginLeft: 4 },
  badgeText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5 },
  tiles: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, minWidth: 0 },
  tileLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  reentry: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10, gap: 4 },
  reentryTag: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  timeline: { borderLeftWidth: 2, marginLeft: 5, paddingLeft: 13, gap: 12, marginTop: 4 },
  leg: { position: 'relative' },
  dot: { position: 'absolute', left: -20, top: 3, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  legHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
  legTime: { fontSize: 11.5, fontVariant: ['tabular-nums'] },
  legTitle: { fontSize: 13, fontWeight: '700' },
  legMeta: { fontSize: 11.5, marginTop: 2, fontVariant: ['tabular-nums'] },
  note: { fontSize: 11.5, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, marginTop: 4, overflow: 'hidden' },
  bars: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  bar: { fontSize: 10, fontVariant: ['tabular-nums'], borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  techLine: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 2, flexWrap: 'wrap' },
  callout: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  collapse: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, marginTop: 8 },
  collapseTitle: { fontSize: 12.5, fontWeight: '600', paddingVertical: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
});
