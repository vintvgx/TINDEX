// The Edit card's TP ladder (spec 2026-11-10 §4.6): one row per rung —
// engine TP1/TP2 and every chart / Edit line — sorted by premium. User rows
// edit by stock price, premium or %, kept in sync through ONE delta, with a
// qty stepper; a footer checks that every contract is accounted for and
// shows the delta used. The rows are the same rung objects the chart draws
// (both come from the engine's tp_ladder), so the two views can't drift.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { LadderRung, TpRungInput } from '@/hooks/queries/strategy/useStrategyLivePrice';
import {
  deltaLabel, pctVsEntry, premiumAt, premiumFromPct, round2, stockAt, usableDelta, type DeltaInfo,
} from '@/lib/exitConversion';

interface Row {
  id: string | null;            // null = new, not saved yet
  premium: string;
  stock: string;
  pct: string;
  qty: number;
  source: 'chart-long-press' | 'edit-card';
}

export interface LadderEditState {
  /** The user lines to send as tp_rungs, or null when nothing changed. */
  rungs: TpRungInput[] | null;
  /** Why Save must stay blocked (qty check, bad price, duplicate), or null. */
  problem: string | null;
  /** Engine TP1 / TP2 premiums edited here (the card's only TP editor when a
   *  ladder exists), or undefined when untouched. */
  tp1?: number;
  tp2?: number;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const f2 = (n: number | null | undefined) => (isNum(n) ? n.toFixed(2) : '');

export function TpLadderEditor({
  ladder, entry, qtyRemaining, stock, mid, delta, colors, visible, onChange,
}: {
  ladder: LadderRung[];
  entry: number;
  qtyRemaining: number;
  stock: number | null | undefined;
  mid: number | null | undefined;
  delta: DeltaInfo;
  colors: any;
  /** Rows reset from `ladder` on each open, never mid-edit. */
  visible: boolean;
  onChange: (s: LadderEditState) => void;
}) {
  const ud = usableDelta(delta);
  const quote = ud.delta != null && isNum(stock) && isNum(mid) ? { stock: stock!, premium: mid!, delta: ud.delta } : null;
  const engine = ladder.filter(r => r.source === 'engine');
  const hitUser = ladder.filter(r => r.source !== 'engine' && r.hit);

  const fromLadder = (): Row[] => ladder
    .filter(r => r.source !== 'engine' && !r.hit)
    .map(r => ({
      id: r.key, premium: f2(r.premium),
      stock: f2(quote ? stockAt(quote, r.premium) : r.stock_price),
      pct: entry ? String(Math.round(pctVsEntry(r.premium, entry))) : '',
      qty: r.qty, source: r.source === 'chart-long-press' ? 'chart-long-press' : 'edit-card',
    }));
  const [rows, setRows] = useState<Row[]>(fromLadder);
  // Engine TP1 / TP2 edits: the three inputs' text, absent = unchanged.
  const [engRows, setEngRows] = useState<Record<string, { premium: string; stock: string; pct: string }>>({});
  const engEdit: Record<string, string> = Object.fromEntries(Object.entries(engRows).map(([k, v]) => [k, v.premium]));
  const engFields = (r: LadderRung) => engRows[r.key] ?? {
    premium: f2(r.premium), stock: quote ? f2(stockAt(quote, r.premium)) : '',
    pct: entry ? String(Math.round(pctVsEntry(r.premium, entry))) : '',
  };
  const setEng = (r: LadderRung, patch: Partial<{ premium: string; stock: string; pct: string }>) =>
    setEngRows(e => ({ ...e, [r.key]: { ...engFields(r), ...patch } }));
  const engPremium = (r: LadderRung, t: string) => {
    const p = parseFloat(t);
    setEng(r, { premium: t, stock: quote && isNum(p) ? f2(stockAt(quote, p)) : engFields(r).stock,
                pct: isNum(p) && entry ? String(Math.round(pctVsEntry(p, entry))) : engFields(r).pct });
  };
  const engStock = (r: LadderRung, t: string) => {
    const sv = parseFloat(t);
    if (!quote || !isNum(sv)) { setEng(r, { stock: t }); return; }
    const p = premiumAt(quote, sv);
    setEng(r, { stock: t, premium: f2(p), pct: entry ? String(Math.round(pctVsEntry(p, entry))) : '' });
  };
  const engPct = (r: LadderRung, t: string) => {
    const pc = parseFloat(t);
    if (!isNum(pc) || !entry) { setEng(r, { pct: t }); return; }
    const p = premiumFromPct(pc, entry);
    setEng(r, { pct: t, premium: f2(p), stock: quote ? f2(stockAt(quote, p)) : engFields(r).stock });
  };
  const baseline = useRef('');
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      const r = fromLadder();
      setRows(r);
      setEngRows({});
      baseline.current = JSON.stringify(r.map(x => [x.id, x.premium, x.qty]));
    }
    wasVisible.current = visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const onPremium = (i: number, t: string) => {
    const p = parseFloat(t);
    set(i, { premium: t,
      pct: isNum(p) && entry ? String(Math.round(pctVsEntry(p, entry))) : rows[i].pct,
      stock: isNum(p) && quote ? f2(stockAt(quote, p)) : rows[i].stock });
  };
  const onStock = (i: number, t: string) => {
    const s = parseFloat(t);
    if (!quote || !isNum(s)) { set(i, { stock: t }); return; }
    const p = premiumAt(quote, s);
    set(i, { stock: t, premium: f2(p), pct: entry ? String(Math.round(pctVsEntry(p, entry))) : '' });
  };
  const onPct = (i: number, t: string) => {
    const pc = parseFloat(t);
    if (!isNum(pc) || !entry) { set(i, { pct: t }); return; }
    const p = premiumFromPct(pc, entry);
    set(i, { pct: t, premium: f2(p), stock: quote ? f2(stockAt(quote, p)) : rows[i].stock });
  };
  const addRow = () => {
    const top = Math.max(entry, ...ladder.map(r => r.premium), ...rows.map(r => parseFloat(r.premium) || 0));
    const p = round2(top * 1.15);
    setRows(rs => [...rs, { id: null, premium: f2(p), stock: quote ? f2(stockAt(quote, p)) : '',
      pct: entry ? String(Math.round(pctVsEntry(p, entry))) : '', qty: 1, source: 'edit-card' }]);
  };

  // ── The qty check (§4.6) + validation (§9) ─────────────────────────────
  // Mirrors ExitManager.set_tp_rungs: TP1's allocation is what it sells now
  // plus what the saved first line took from it; the first line takes from
  // TP1 first, the rest from the pool; TP2 gets what's free; the last
  // contract is always the runner. The server re-checks on save.
  const tp1 = engine.find(r => r.key === 'tp1');
  const tp2 = engine.find(r => r.key === 'tp2');
  const tp1Live = !!tp1 && !tp1.hit;
  const savedCarver = ladder.find(r => r.source !== 'engine' && !r.hit && (r.from_tp1 ?? 0) > 0);
  const tp1Base = tp1Live ? tp1!.qty + (savedCarver?.from_tp1 ?? 0) : 0;
  const carver = rows.find(r => r.id != null && r.id === savedCarver?.key) ?? rows[0];
  const carve = tp1Live && carver ? Math.min(carver.qty, tp1Base) : 0;
  const tp1Qty = tp1Base - carve;
  const userQty = rows.reduce((n, r) => n + r.qty, 0);
  const free = qtyRemaining - tp1Qty - userQty;          // TP2 + runner share this
  const tp2Qty = tp2 && !tp2.hit ? Math.max(0, Math.min(tp2.qty, free - 1)) : 0;
  const runner = free - tp2Qty;
  const parts = [...(tp1Qty ? [tp1Qty] : []), ...rows.map(r => r.qty), ...(tp2Qty ? [tp2Qty] : [])];
  const qtyOk = runner >= 1 && rows.length <= qtyRemaining - 1;

  const state = useMemo<LadderEditState>(() => {
    const prices = rows.map(r => parseFloat(r.premium));
    const engVal = (k: string) => (engEdit[k] ? parseFloat(engEdit[k]) : undefined);
    const tp1New = engVal('tp1'), tp2New = engVal('tp2');
    const enginePrem = (r: LadderRung) => (engEdit[r.key] ? parseFloat(engEdit[r.key]) : r.premium);
    let problem: string | null = null;
    if (tp1New !== undefined && (!isNum(tp1New) || tp1New <= entry)) problem = `TP1 must be above entry ($${entry.toFixed(2)})`;
    else if (tp2New !== undefined && (!isNum(tp2New) || tp2New <= (tp1New ?? tp1?.premium ?? entry))) problem = 'TP2 must be above TP1';
    else
    if (prices.some(p => !isNum(p) || p <= 0)) problem = 'Every TP line needs a premium above $0';
    else if (rows.some(r => r.qty < 1)) problem = 'Every TP line sells at least 1 contract';
    else {
      const all = [...prices, ...engine.filter(r => !r.hit).map(enginePrem)];
      const dup = all.find((p, i) => all.some((q, j) => j !== i && Math.abs(p - q) < 0.005));
      if (dup != null) problem = `Already a line at $${dup.toFixed(2)}`;
      else if (!qtyOk) problem = `Contracts don't add up — the last contract must stay the runner (${qtyRemaining} open)`;
    }
    const sig = JSON.stringify(rows.map(x => [x.id, x.premium, x.qty]));
    return {
      rungs: sig === baseline.current ? null : rows.map(r => ({
        id: r.id ?? undefined, premium: round2(parseFloat(r.premium)), qty: r.qty,
        stock_price: isNum(parseFloat(r.stock)) ? round2(parseFloat(r.stock)) : null, source: r.source,
      })),
      problem,
      tp1: isNum(tp1New) ? round2(tp1New) : undefined,
      tp2: isNum(tp2New) ? round2(tp2New) : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, qtyOk, engRows]);
  useEffect(() => { onChange(state); }, [state, onChange]);

  // Display rows: engine + user, premium order, renumbered.
  type Disp = { key: string; premium: number; label?: string; user?: number; engine?: LadderRung; hit?: boolean };
  const disp: Disp[] = [
    ...engine.map(r => ({ key: r.key, premium: engEdit[r.key] ? parseFloat(engEdit[r.key]) || r.premium : r.premium, engine: r, hit: r.hit })),
    ...hitUser.map(r => ({ key: r.key, premium: r.premium, engine: r, hit: true })),
    ...rows.map((r, i) => ({ key: r.id ?? `new-${i}`, premium: parseFloat(r.premium) || 0, user: i })),
  ].sort((a, b) => a.premium - b.premium).map((d, i) => ({ ...d, label: `TP${i + 1}` }));

  const muted = colors.textTertiary;
  return (
    <View style={{ gap: 6, marginTop: 10 }}>
      <View style={st.head}>
        <Text style={[st.h, { color: muted, flex: 0.9 }]}>Rung</Text>
        <Text style={[st.h, { color: muted, flex: 1.4 }]}>Stock</Text>
        <Text style={[st.h, { color: muted, flex: 1.2 }]}>Premium</Text>
        <Text style={[st.h, { color: muted, flex: 0.9 }]}>%</Text>
        <Text style={[st.h, { color: muted, flex: 1.4, textAlign: 'right' }]}>Qty</Text>
      </View>
      {disp.map(d => {
        if (d.user == null) {
          const r = d.engine!;
          const q = r.key === 'tp1' ? tp1Qty : r.key === 'tp2' ? tp2Qty : r.qty;
          // Unfired engine TP1 / TP2: same stock / premium / % inputs as a
          // user line — premium is what saves (qty follows the profile).
          if (!r.hit && (r.key === 'tp1' || r.key === 'tp2')) {
            const ef = engFields(r);
            return (
              <View key={d.key} style={[st.row, { borderColor: colors.separator }]}>
                <Text style={[st.cell, { flex: 0.9, color: colors.text }]}>{d.label}</Text>
                <TextInput value={ef.stock} editable={!!quote} keyboardType="decimal-pad" onChangeText={t => engStock(r, t)}
                  style={[st.input, { flex: 1.4, color: colors.text, borderColor: colors.border, opacity: quote ? 1 : 0.4 }]}
                  accessibilityLabel={`${d.label} stock price`} />
                <TextInput value={ef.premium} onChangeText={t => engPremium(r, t)} keyboardType="decimal-pad"
                  style={[st.input, { flex: 1.2, color: colors.success, borderColor: colors.border }]} accessibilityLabel={`${d.label} premium`} />
                <TextInput value={ef.pct} keyboardType="numbers-and-punctuation" onChangeText={t => engPct(r, t)}
                  style={[st.input, { flex: 0.9, color: colors.success, borderColor: colors.border }]} accessibilityLabel={`${d.label} percent vs entry`} />
                <View style={{ flex: 1.4, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                  <Text style={[st.cell, st.num, { color: colors.text }]}>{q}</Text>
                  <Text style={[st.tag, { color: muted, borderColor: colors.border }]}>engine</Text>
                </View>
              </View>
            );
          }
          return (
            <View key={d.key} style={[st.row, { borderColor: colors.separator }]}>
              <Text style={[st.cell, { flex: 0.9, color: r.hit ? colors.success : colors.text }]}>{r.hit ? '✓ ' : ''}{d.label}</Text>
              <Text style={[st.cell, st.num, { flex: 1.4, color: colors.textSecondary }]}>{quote ? `≈ ${f2(stockAt(quote, r.premium))}` : '—'}</Text>
              <Text style={[st.cell, st.num, { flex: 1.2, color: colors.text }]}>${f2(r.hit && r.hit_premium ? r.hit_premium : r.premium)}</Text>
              <Text style={[st.cell, st.num, { flex: 0.9, color: colors.success }]}>{entry ? `${Math.round(pctVsEntry(r.premium, entry))}` : ''}</Text>
              <View style={{ flex: 1.4, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                <Text style={[st.cell, st.num, { color: colors.text }]}>{r.hit ? 'sold' : q}</Text>
                <Text style={[st.tag, { color: muted, borderColor: colors.border }]}>{r.source === 'engine' ? 'engine' : 'chart'}</Text>
              </View>
            </View>
          );
        }
        const i = d.user;
        const r = rows[i];
        return (
          <View key={d.key} style={[st.row, { borderColor: colors.separator }]}>
            <Text style={[st.cell, { flex: 0.9, color: colors.text }]}>{d.label}</Text>
            <TextInput value={r.stock} onChangeText={t => onStock(i, t)} editable={!!quote} keyboardType="decimal-pad"
              style={[st.input, { flex: 1.4, color: colors.text, borderColor: colors.border, opacity: quote ? 1 : 0.4 }]} accessibilityLabel={`${d.label} stock price`} />
            <TextInput value={r.premium} onChangeText={t => onPremium(i, t)} keyboardType="decimal-pad"
              style={[st.input, { flex: 1.2, color: colors.success, borderColor: colors.border }]} accessibilityLabel={`${d.label} premium`} />
            <TextInput value={r.pct} onChangeText={t => onPct(i, t)} keyboardType="numbers-and-punctuation"
              style={[st.input, { flex: 0.9, color: colors.success, borderColor: colors.border }]} accessibilityLabel={`${d.label} percent vs entry`} />
            <View style={{ flex: 1.4, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
              <Pressable onPress={() => set(i, { qty: Math.max(1, r.qty - 1) })} hitSlop={6} style={[st.step, { borderColor: colors.border }]}><Text style={{ color: colors.text }}>−</Text></Pressable>
              <Text style={[st.cell, st.num, { color: colors.text, minWidth: 14, textAlign: 'center' }]}>{r.qty}</Text>
              <Pressable onPress={() => set(i, { qty: r.qty + 1 })} hitSlop={6} style={[st.step, { borderColor: colors.border }]}><Text style={{ color: colors.text }}>+</Text></Pressable>
              <Pressable onPress={() => setRows(rs => rs.filter((_, j) => j !== i))} hitSlop={6} accessibilityLabel={`Delete ${d.label}`}>
                <Text style={{ color: colors.error, fontWeight: '700', marginLeft: 2 }}>✕</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <View style={[st.row, { borderColor: colors.separator }]}>
        <Text style={[st.cell, { flex: 1, color: colors.textSecondary }]}>Runner</Text>
        <Text style={[st.cell, st.num, { color: colors.text }]}>{Math.max(0, runner)}</Text>
      </View>
      {qtyRemaining > 1 + rows.length ? (
        <Pressable onPress={addRow} style={[st.add, { borderColor: colors.border }]} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>+ Add TP line</Text>
        </Pressable>
      ) : null}
      <View style={st.foot}>
        <Text style={[st.num, { color: qtyOk ? colors.success : colors.error, fontSize: 12, fontWeight: '600' }]}>
          {[...parts, `${Math.max(0, runner)} runner`].join(' + ')} = {qtyRemaining} {qtyOk ? '✓' : '✗'}
        </Text>
        <Text style={[st.num, { color: quote ? colors.textTertiary : colors.warning, fontSize: 11.5 }]}>
          {quote ? deltaLabel(delta) : `${ud.reason ?? 'no live quote'} — showing premium only`}
        </Text>
      </View>
      {state.problem ? <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>{state.problem}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
  h: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { fontSize: 13, fontWeight: '600' },
  num: { fontVariant: ['tabular-nums'] },
  input: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 0 },
  tag: { fontSize: 9.5, fontWeight: '700', borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  step: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  add: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 9, paddingVertical: 8, alignItems: 'center' },
  foot: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, paddingTop: 4 },
});
