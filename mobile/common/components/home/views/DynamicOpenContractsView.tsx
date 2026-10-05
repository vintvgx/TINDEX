import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
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
            {positions.map((p) => {
              const dirColor = p.direction === 'PUT' ? colors.error : colors.success;
              const pnl = p.unrealized_pnl ?? 0;
              const pnlPct = p.unrealized_pnl_pct;
              const pnlColor = pnl >= 0 ? colors.success : colors.error;
              const qty = p.qty_remaining ?? 0;
              const mv = p.current_price != null ? p.current_price * qty * 100 : null;
              const modeColor = p.paper_mode ? colors.warning : colors.success;
              const meta = (label: string, value: string, color?: string) => (
                <Text style={[styles.mono, { fontSize: 10.5, color: colors.textTertiary }]}>
                  {label} <Text style={{ color: color ?? colors.textSecondary, fontWeight: '700' }}>{value}</Text>
                </Text>
              );
              return (
                <TouchableOpacity
                  key={p.strategy_id}
                  activeOpacity={0.7}
                  onPress={() => setEditing(p)}
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
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: pnlColor }]}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                      {pnlPct != null ? ` (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)` : ''}
                    </Text>
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
                        {p.current_price != null ? `$${p.current_price.toFixed(2)}` : '—'}
                      </Text>
                    </Text>
                  </View>
                  {/* value · stop · targets */}
                  <View style={[styles.line, { marginTop: 4, flexWrap: 'wrap', columnGap: 12, rowGap: 2 }]}>
                    {meta('Value', mv != null ? `$${mv.toFixed(2)}` : '—', colors.text)}
                    {p.sl_enabled !== false && p.hard_stop ? meta('SL', `$${p.hard_stop.toFixed(2)}`, colors.error) : null}
                    {p.tp_enabled !== false && p.tp1 ? meta('TP1', `$${p.tp1.toFixed(2)}${p.tp1_hit ? ' ✓' : ''}`, colors.success) : null}
                    {p.use_tp2 && p.tp2 ? meta('TP2', `$${p.tp2.toFixed(2)}${p.tp2_hit ? ' ✓' : ''}`, colors.success) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {editing && (
        <PositionEditSheet pos={editing} visible onClose={() => setEditing(null)} />
      )}
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
