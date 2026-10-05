import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import { SlGraceBadge } from '@/common/components/strategy/SlGraceBadge';
import type { SlGraceInfo } from '@/common/components/strategy/SlGraceBadge';
import { AddContractModal } from '@/common/components/strategy/AddContractModal';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { PositionEditSheet } from '../PositionEditSheet';

/**
 * Dynamic card "open" view: contracts you actually hold (live + paper
 * positions). Tapping one opens its edit sheet. Watched contracts have
 * their own page (DynamicContractsView).
 */
export function DynamicOpenContractsView() {
  const colors = useThemeColors();
  const live = useLivePositionsData('live');
  const paper = useLivePositionsData('paper');
  // Live first, then paper.
  const positions = useMemo(
    () => [...live.filteredPositions, ...paper.filteredPositions],
    [live.filteredPositions, paper.filteredPositions],
  );
  const isLoading = live.isLoading || paper.isLoading;
  const [editing, setEditing] = useState<PositionEntry | null>(null);

  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
            OPEN CONTRACTS
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
            {positions.length} OPEN
          </Text>
        </View>

        {isLoading && positions.length === 0 ? (
          <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16 }}>Loading positions…</Text>
        ) : positions.length === 0 ? (
          <View style={{ marginTop: 20, alignItems: 'center', gap: 8 }}>
            <Ionicons name="briefcase-outline" size={28} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center' }}>
              No open contracts.
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: 6 }}>
            {positions.map((p) => (
              <DynamicPositionRow
                key={p.strategy_id}
                pos={p}
                colors={colors}
                onEdit={() => setEditing(p)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {editing && (
        <PositionEditSheet pos={editing} visible onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/**
 * One open-contract row. Subscribes to the same live-price feed the chart's
 * position rows use (useStrategyLivePrice), so PnL / mark tick in real time
 * here too — the row previously only showed the query's cached
 * unrealized_pnl, which is why home lagged the chart. Falls back to the
 * static values when the socket hasn't delivered yet.
 */
function DynamicPositionRow({ pos: p, colors, onEdit }: {
  pos: PositionEntry; colors: any; onEdit: () => void;
}) {
  const { data: live } = useStrategyLivePrice(p.strategy_id, p.active);
  const [addOpen, setAddOpen] = useState(false);

  const dirColor = p.direction === 'PUT' ? colors.error : colors.success;
  const pnl = live?.pnl ?? p.unrealized_pnl ?? 0;
  const pnlPct = live?.pnl_pct ?? p.unrealized_pnl_pct;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const qty = live?.qty_remaining ?? p.qty_remaining ?? 0;
  const curPrice = live?.mid_price ?? p.current_price;
  const mv = live?.market_value ?? (curPrice != null ? curPrice * qty * 100 : null);
  const modeColor = p.paper_mode ? colors.warning : colors.success;
  // TP state comes from the live feed (same source the chart rows use) so a
  // hit shows here the moment it happens, not on the next query refetch.
  const tp1Hit = live?.tp1_hit ?? p.tp1_hit;
  const tp2Hit = live?.tp2_hit ?? p.tp2_hit;
  const graceInfo: SlGraceInfo = {
    sl_grace_active: live?.sl_grace_active,
    sl_grace_deadline: live?.sl_grace_deadline,
    sl_recovery_deadline: live?.sl_recovery_deadline,
    sl_grace_enabled: live?.sl_grace_enabled ?? p.sl_grace_enabled,
    sl_grace_minutes: live?.sl_grace_minutes ?? p.sl_grace_minutes,
    tp1_hit: tp1Hit,
    sl_outer_floor: live?.sl_outer_floor ?? p.sl_outer_floor,
    sl_floor_enabled: live?.sl_floor_enabled ?? p.sl_floor_enabled,
    be_grace_active: live?.be_grace_active,
    be_grace_deadline: live?.be_grace_deadline,
    be_grace_seconds: live?.be_grace_seconds ?? p.be_grace_seconds,
  };
  const meta = (label: string, value: string, color?: string) => (
    <Text style={[styles.mono, { fontSize: 10.5, color: colors.textTertiary }]}>
      {label} <Text style={{ color: color ?? colors.textSecondary, fontWeight: '700' }}>{value}</Text>
    </Text>
  );
  const tpHitChip = tp2Hit ? 'TP2 ✓' : tp1Hit ? 'TP1 ✓' : null;

  return (
    <>
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onEdit}
      style={[styles.item, { borderColor: colors.border }]}
      accessibilityLabel={`Edit ${p.ticker} position`}
    >
      {/* ticker · direction · LIVE/PAPER ........ P&L */}
      <View style={styles.line}>
        <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: colors.text }]}>{p.ticker}</Text>
        {p.direction && (
          <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
            <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: dirColor }]}>{p.direction}</Text>
          </View>
        )}
        <View style={[styles.badge, { backgroundColor: modeColor + '1E', borderColor: modeColor + '44' }]}>
          <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: modeColor }]}>
            {p.paper_mode ? 'PAPER' : 'LIVE'}
          </Text>
        </View>
        {tpHitChip && (
          <View style={[styles.badge, { backgroundColor: colors.success + '22', borderColor: colors.success + '55' }]}>
            <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: colors.success }]}>{tpHitChip}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: pnlColor }]}>
          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
          {pnlPct != null ? ` (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)` : ''}
        </Text>
        {/* Add to position — same AddContractModal the chart rows use. */}
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation(); setAddOpen(true); }}
          hitSlop={8}
          activeOpacity={0.7}
          style={{ padding: 4, borderRadius: 12, backgroundColor: colors.text + '0F' }}
          accessibilityLabel={`Add to ${p.ticker} position`}
        >
          <Ionicons name="add" size={15} color={colors.textSecondary} />
        </TouchableOpacity>
        <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />
      </View>
      {/* contract × qty · entry → now */}
      <View style={[styles.line, { marginTop: 5 }]}>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>
          {p.contract ? shortContract(p.contract) : '—'} × {qty}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]}>
          {p.entry_premium != null ? `$${p.entry_premium.toFixed(2)}` : '—'}
          {' → '}
          <Text style={{ color: colors.text, fontWeight: '700' }}>
            {curPrice != null ? `$${curPrice.toFixed(2)}` : '—'}
          </Text>
        </Text>
      </View>
      {/* value · stop · targets */}
      <View style={[styles.line, { marginTop: 4, flexWrap: 'wrap', columnGap: 12, rowGap: 2 }]}>
        {meta('Value', mv != null ? `$${mv.toFixed(2)}` : '—', colors.text)}
        {p.sl_enabled !== false && p.hard_stop ? meta('SL', `$${p.hard_stop.toFixed(2)}`, colors.error) : null}
        {p.tp_enabled !== false && p.tp1 ? meta('TP1', `$${p.tp1.toFixed(2)}${tp1Hit ? ' ✓' : ''}`, tp1Hit ? colors.success : undefined) : null}
        {p.use_tp2 && p.tp2 ? meta('TP2', `$${p.tp2.toFixed(2)}${tp2Hit ? ' ✓' : ''}`, tp2Hit ? colors.success : undefined) : null}
      </View>
      {/* Live SL / breakeven grace countdown — same badge the chart rows
          use, so a running stop timer shows here the moment it starts. */}
      <SlGraceBadge live={graceInfo} colors={colors} hideIdle />
    </TouchableOpacity>
    <AddContractModal
      visible={addOpen}
      colors={colors}
      strategyId={p.strategy_id}
      ticker={p.ticker}
      contract={live?.contract ?? p.contract}
      qtyHeld={qty}
      entryPremium={live?.entry_premium ?? p.entry_premium}
      midPrice={curPrice}
      paperMode={p.paper_mode}
      onClose={() => setAddOpen(false)}
    />
    </>
  );
}

/** "AMZN251002C00252500" → "252.5C 10/02" (best-effort). */
function shortContract(symbol: string): string {
  const m = symbol.match(/^[A-Z]+(\d{6})([CP])(\d{8})$/);
  if (!m) return symbol;
  const [, yymmdd, cp, strike] = m;
  const s = (Number(strike) / 1000).toFixed(2).replace(/\.?0+$/, '');
  return `${s}${cp} ${yymmdd.slice(2, 4)}/${yymmdd.slice(4, 6)}`;
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  item: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
});
