import { View, Text, StyleSheet } from 'react-native';

export interface ExitPlan {
  premium: number;             // entry estimate (per share)
  qty: number;
  stopPrice: number | null;    // null = no automatic stop
  stopLabel: string;           // "Hard stop" | "5-min SL timer" | "Off"
  floorPrice: number | null;   // worst-case floor (null = none)
  floorIsDefault?: boolean;    // floor comes from the strategy/stop-type default
  beGraceSeconds: number;      // post-TP1 breakeven grace (0 = none)
  tp1Price: number | null;
  tp2Price: number | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * The exit plan as a price ladder, highest to lowest — what happens at each
 * level, in order — shown at confirm time (OrderReviewSheet, the strategy
 * confirm-entry modal) so the whole plan is visible before the order goes in.
 */
export function ExitPlanLadder({ plan, colors }: { plan: ExitPlan; colors: any }) {
  const per = (price: number) => (price - plan.premium) * plan.qty * 100;
  const rows: { key: string; label: string; price: number | null; note: string; color: string }[] = [];
  if (plan.tp2Price != null) {
    rows.push({ key: 'tp2', label: 'TP2', price: plan.tp2Price, note: `runner target · +${money(per(plan.tp2Price))}`, color: colors.success });
  }
  if (plan.tp1Price != null) {
    rows.push({ key: 'tp1', label: 'TP1', price: plan.tp1Price, note: `partial close · +${money(per(plan.tp1Price))}, then stop → breakeven`, color: colors.success });
  }
  rows.push({
    key: 'entry', label: 'Entry / breakeven', price: plan.premium,
    note: plan.tp1Price == null
      ? 'no TP — no breakeven move'
      : plan.beGraceSeconds > 0
        ? `after TP1: a dip below is checked after ${plan.beGraceSeconds}s`
        : 'after TP1: sells on first confirmed touch',
    color: colors.text,
  });
  rows.push({
    key: 'stop', label: plan.stopPrice == null ? 'Stop loss' : plan.stopLabel, price: plan.stopPrice,
    note: plan.stopPrice == null ? 'off — no automatic stop' : `−${money(-per(plan.stopPrice))} · before TP1 only`,
    color: plan.stopPrice == null ? colors.warning : colors.error,
  });
  rows.push({
    key: 'floor', label: 'Worst-case floor', price: plan.floorPrice,
    note: plan.floorPrice == null
      ? 'none'
      : `sells no matter what · −${money(-per(plan.floorPrice))}${plan.floorIsDefault ? ' (default)' : ''}`,
    color: plan.floorPrice == null ? colors.textTertiary : colors.error,
  });

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((r, i) => (
        <View key={r.key} style={s.row}>
          <View style={s.rail}>
            <View style={[s.dot, { backgroundColor: r.color }]} />
            {i < rows.length - 1 && <View style={[s.line, { backgroundColor: colors.separator }]} />}
          </View>
          <View style={{ flex: 1, paddingBottom: i < rows.length - 1 ? 12 : 0 }}>
            <View style={s.head}>
              <Text style={[s.label, { color: colors.text }]}>{r.label}</Text>
              <Text style={[s.price, { color: r.color }]}>{r.price == null ? '—' : `≈ ${money(r.price)}`}</Text>
            </View>
            <Text style={[s.note, { color: colors.textTertiary }]}>{r.note}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  row: { flexDirection: 'row', gap: 10 },
  rail: { width: 10, alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 },
  line: { width: StyleSheet.hairlineWidth * 2, flex: 1, marginTop: 3 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: 14, fontWeight: '600' },
  price: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});
