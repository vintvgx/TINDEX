// Chart-set exits (spec 2026-11-10 §4): the sheet behind long-press → ⊕ and
// behind tapping / dragging a trade line. Stock price is the input language;
// the PREMIUM is what's saved and what executes (§5). Everything is written
// through PATCH /strategy/configs/<id>/exits — the same path the Edit card
// uses — so a line set here lives on the trade, survives a restart, and is
// the same rung object the Edit card shows (§4.6, §6).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import type { LadderRung, LivePriceData, TpRungInput } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useUpdateStrategyExits } from '@/hooks/mutations/strategy/useUpdateStrategyExits';
import { useContractDelta } from '@/hooks/queries/strategy/useContractDelta';
import { useToast } from '@/common/components/ui/Toast';
import {
  deltaLabel, pctVsEntry, premiumAt, premiumFromPct, round2, smartDefault, SNAP_TO_BE_STOCK, stockAt, usableDelta,
  type DeltaInfo,
} from '@/lib/exitConversion';
import type { TradePreviewLine } from './TVChart';

export interface ExitSheetTrade {
  strategyId: string;
  contract: string;
  direction: 'CALL' | 'PUT';
  /** "770C · Nov 10 · 4 open" */
  label: string;
  live: LivePriceData;
}

export type ExitSheetRequest =
  | { mode: 'new'; stock: number }
  /** A selected trade line; `stock` is where a drag left it (null = as is). */
  | { mode: 'edit'; key: string; stock: number | null };

type Kind = 'tp' | 'sl' | 'be';

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const fmt = (n: number | null | undefined, d = 2) => (isNum(n) ? n.toFixed(d) : '');

/** User (chart / Edit) rungs still to fire, as the PATCH body expects them. */
export function userRungs(ladder: LadderRung[] | null | undefined): TpRungInput[] {
  return (ladder ?? [])
    .filter(r => r.source !== 'engine' && !r.hit)
    .map(r => ({
      id: r.key, premium: r.premium, qty: r.qty, stock_price: r.stock_price ?? null,
      source: (r.source === 'chart-long-press' ? 'chart-long-press' : 'edit-card') as TpRungInput['source'],
    }));
}

export function ChartExitSheet({
  request, trades, defaultStrategyId, colors, onClose, onSetAlert, onPreview,
}: {
  request: ExitSheetRequest | null;
  trades: ExitSheetTrade[];
  defaultStrategyId: string | null;
  colors: any;
  onClose: () => void;
  /** "Set alert instead" — today's crossing alert at the pressed price. */
  onSetAlert: (stock: number) => void;
  onPreview: (line: TradePreviewLine | null) => void;
}) {
  const toast = useToast();
  const save = useUpdateStrategyExits();
  const visible = request != null;
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('tp');
  const [stockText, setStockText] = useState('');
  const [premText, setPremText] = useState('');
  const [pctText, setPctText] = useState('');
  const [qty, setQty] = useState(1);
  const [confirmArmed, setConfirmArmed] = useState<string | null>(null);
  const [deltaNonce, setDeltaNonce] = useState(0);

  const trade = trades.find(t => t.strategyId === strategyId) ?? trades.find(t => t.strategyId === defaultStrategyId) ?? trades[0];
  const live = trade?.live;
  const ladder = live?.tp_ladder ?? [];
  const editKey = request?.mode === 'edit' ? request.key : null;
  const editRung = editKey ? ladder.find(r => r.key === editKey) ?? null : null;
  const editIsUser = !!editRung && editRung.source !== 'engine';

  // Fresh per-contract snapshot delta on open / after a drag (§3.2).
  const fresh = useContractDelta(trade?.contract, deltaNonce, visible);
  const deltaInfo: DeltaInfo = fresh.data?.delta != null
    ? { delta: fresh.data.delta, source: 'snapshot', ageS: (Date.now() - fresh.data.fetchedAt) / 1000 }
    : { delta: live?.delta, source: live?.delta_source ?? null, ageS: live?.delta_age_s };
  const ud = usableDelta(deltaInfo);
  const u = isNum(live?.underlying_price) ? live!.underlying_price! : null;
  const cur = isNum(live?.mid_price) ? live!.mid_price : null;
  const entry = live?.entry_premium ?? 0;
  const convOK = ud.delta != null && u != null && cur != null;
  const quote = convOK ? { stock: u!, premium: cur!, delta: ud.delta! } : null;
  const qtyRem = live?.qty_remaining ?? 0;

  // ── (Re)initialise on each new request, and on each trade switch ──────
  // Fields are always computed from the RESOLVED trade object passed in —
  // never from this render's derived values, which still belong to the
  // previous request's trade until the next render (PR #121 thread 8: with
  // two trades on one ticker, that saved one contract's premium onto the
  // other trade).
  const applyFields = (t: ExitSheetTrade, req: ExitSheetRequest) => {
    const lv = t.live;
    const lad = lv.tp_ladder ?? [];
    const d = usableDelta({ delta: lv.delta, source: lv.delta_source ?? null, ageS: lv.delta_age_s });
    const uu = isNum(lv.underlying_price) ? lv.underlying_price! : null;
    const cc = isNum(lv.mid_price) ? lv.mid_price : null;
    const q = d.delta != null && uu != null && cc != null ? { stock: uu, premium: cc, delta: d.delta } : null;
    const en = lv.entry_premium ?? 0;
    let k: Kind = 'tp';
    let stockV: number | null = req.stock ?? null;
    let premV: number | null = null;
    const r = req.mode === 'edit' ? lad.find(x => x.key === req.key) ?? null : null;
    if (req.mode === 'new') {
      k = uu != null ? smartDefault(t.direction, req.stock, uu) : 'tp';
    } else {
      k = req.key === 'sl' ? 'sl' : req.key === 'be' ? 'be' : 'tp';
      premV = r ? r.premium : req.key === 'sl' || req.key === 'be' ? lv.hard_stop : null;
      if (req.stock == null) stockV = q && premV != null ? stockAt(q, premV) : r?.stock_price ?? null;
      else premV = null;   // dragged: the new stock price drives the premium
    }
    if (premV == null && stockV != null && q) premV = premiumAt(q, stockV);
    setKind(k);
    setStockText(fmt(stockV));
    setPremText(fmt(premV));
    setPctText(premV != null && en ? String(Math.round(pctVsEntry(premV, en))) : '');
    // First line before TP1 fires takes TP1's qty by default (§4.5); clamp
    // to what can be saved so the sheet never opens in an error state (N1).
    const tp1r = lad.find(x => x.key === 'tp1');
    const firstLine = userRungs(lad).length === 0 && tp1r && !tp1r.hit;
    const others = userRungs(lad).filter(x => x.id !== (req.mode === 'edit' ? req.key : undefined));
    const cap = Math.max(1, lv.qty_remaining - 1 - others.reduce((n, x) => n + x.qty, 0));
    setQty(Math.min(cap, r ? r.qty : Math.max(1, firstLine ? tp1r!.qty : 1)));
    setConfirmArmed(null);
  };
  const reqRef = useRef<ExitSheetRequest | null>(null);
  useEffect(() => {
    if (!request) { reqRef.current = null; setStrategyId(null); return; }   // closed: forget the pick
    if (request === reqRef.current) return;
    reqRef.current = request;
    setDeltaNonce(n => n + 1);
    const resolved = trades.find(t => t.strategyId === defaultStrategyId) ?? trades[0];
    if (!resolved) return;
    setStrategyId(resolved.strategyId);
    applyFields(resolved, request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  const pickTrade = (t: ExitSheetTrade) => {
    if (!request || t.strategyId === trade?.strategyId) return;
    setStrategyId(t.strategyId);
    setDeltaNonce(n => n + 1);
    applyFields(t, request);
  };

  // Trade closed under the open sheet (§9).
  useEffect(() => {
    if (visible && trades.length === 0) {
      toast.info('Trade closed — exits cleared');
      onPreview(null);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, trades.length]);

  const stock = parseFloat(stockText);
  const prem = parseFloat(premText);
  const stockOK = isNum(stock) && stock > 0;
  const premOK = isNum(prem) && prem > 0;

  // ── Two-way inputs through one delta (§4.2, §5) ────────────────────────
  const onStock = (t: string) => {
    setStockText(t); setConfirmArmed(null);
    const s = parseFloat(t);
    if (quote && isNum(s)) {
      const p = premiumAt(quote, s);
      setPremText(fmt(p));
      setPctText(entry ? String(Math.round(pctVsEntry(p, entry))) : '');
    }
  };
  const onPrem = (t: string) => {
    setPremText(t); setConfirmArmed(null);
    const p = parseFloat(t);
    if (isNum(p)) {
      setPctText(entry ? String(Math.round(pctVsEntry(p, entry))) : '');
      if (quote) setStockText(fmt(stockAt(quote, p)));
    }
  };
  const onPct = (t: string) => {
    setPctText(t); setConfirmArmed(null);
    const pc = parseFloat(t);
    if (isNum(pc) && entry) {
      const p = premiumFromPct(pc, entry);
      setPremText(fmt(p));
      if (quote) setStockText(fmt(stockAt(quote, p)));
    }
  };
  const nudge = (d: number) => stockOK && onStock(fmt(round2(stock + d)));

  // ── Preview line at the pressed / edited price ─────────────────────────
  useEffect(() => {
    if (!visible || !stockOK) { onPreview(null); return; }
    const color = kind === 'sl' ? colors.error : kind === 'be' ? colors.textSecondary : colors.success;
    onPreview({ price: round2(stock), color, style: kind === 'sl' ? 'dotted' : 'dashed',
                title: `${kind.toUpperCase()} ≈ $${fmt(premOK ? prem : null) || '—'}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, stockText, premText, kind]);

  // ── Rules ──────────────────────────────────────────────────────────────
  const dir = trade?.direction ?? 'CALL';
  const profitSide = (s: number) => (u == null ? true : dir === 'CALL' ? s > u : s < u);
  const beStock = quote ? stockAt(quote, entry) : null;
  const snapToBE = request?.mode === 'new' && beStock != null && stockOK && !profitSide(stock)
    && Math.abs(stock - beStock) <= SNAP_TO_BE_STOCK;
  // A TP dragged across the price is offered as a stop — never flipped silently (§4.3).
  const flipped = request?.mode === 'edit' && editIsUser && kind === 'tp' && stockOK && u != null && !profitSide(stock);
  const otherUser = userRungs(ladder).filter(r => r.id !== editKey);
  const qtyCap = Math.max(1, qtyRem - 1 - otherUser.reduce((n, r) => n + r.qty, 0));
  const tp1 = ladder.find(r => r.key === 'tp1');
  const carves = kind === 'tp' && !editRung && otherUser.length === 0 && tp1 && !tp1.hit ? Math.min(qty, tp1.qty) : 0;

  const floorOn = live?.sl_floor_enabled !== false && isNum(live?.sl_outer_floor);
  const problem = useMemo<string | null>(() => {
    if (!trade || !live) return 'No open contract on this ticker';
    if (!premOK) return convOK ? 'Enter a price' : 'Enter the premium (delta unavailable — premium only)';
    // Stops (SL, or the armed BE stop being moved): below the live premium,
    // and above an armed floor — the floor would otherwise sell first.
    if (kind === 'sl' || kind === 'be' || flipped) {
      if (cur != null && prem >= cur) return `A stop sits below the current premium ($${cur.toFixed(2)})`;
      if (floorOn && prem <= live.sl_outer_floor!) {
        return `Stop $${prem.toFixed(2)} is at or below the floor $${live.sl_outer_floor!.toFixed(2)}, which would sell first`;
      }
    }
    if (kind === 'tp' && !flipped && prem <= entry) return `A TP sits above entry ($${entry.toFixed(2)}) — below it, set a stop`;
    if (kind === 'tp' && !flipped && stockOK && u != null && !profitSide(stock) && convOK) {
      return `A TP sits ${dir === 'CALL' ? 'above' : 'below'} the current price ($${u.toFixed(2)})`;
    }
    if (kind === 'sl' && stockOK && u != null && profitSide(stock) && convOK) {
      return `A stop sits ${dir === 'CALL' ? 'below' : 'above'} the current price ($${u.toFixed(2)})`;
    }
    if (kind === 'tp' && !flipped) {
      const clash = ladder.find(r => r.key !== editKey && !r.hit && Math.abs(r.premium - prem) < 0.005);
      if (clash) return `Already a line at $${clash.premium.toFixed(2)} (${clash.label})`;
      if (qty < 1 || qty > qtyCap) return `Sell 1–${qtyCap} (the last contract stays the runner)`;
      if (qtyRem <= 1) return 'A 1-contract trade has no room for another TP';
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade, live, premOK, convOK, kind, flipped, stockOK, stock, u, dir, prem, qty, qtyCap, qtyRem, editKey, ladder, cur, floorOn, entry]);

  const immediate = kind === 'tp' && !flipped && premOK && cur != null && prem <= cur;

  const close = () => { onPreview(null); onClose(); };

  const submit = (body: Record<string, unknown>, done: string) => {
    if (!trade) return;
    save.mutate({ strategy_id: trade.strategyId, ...body } as any, {
      onSuccess: () => { toast.success(done); close(); },
      onError: (e: Error) => { toast.error(e.message || 'Save failed — nothing changed'); close(); },
    });
  };

  const onSave = (as: Kind) => {
    if (!trade || !live || problem) return;
    if (as === 'tp' && immediate && confirmArmed !== 'immediate') { setConfirmArmed('immediate'); return; }
    const p = round2(prem);
    const sp = stockOK ? round2(stock) : null;
    if (as === 'be' && editKey === 'be') {
      // The armed BE line IS the stop: moving it moves the stop to here.
      submit({ hard_stop: p, sl_enabled: true }, `Stop moved to $${p.toFixed(2)}${sp != null ? ` (≈ ${sp.toFixed(2)})` : ''}`);
    } else if (as === 'be') {
      submit({ hard_stop: round2(entry), sl_enabled: true }, `Stop set to breakeven $${entry.toFixed(2)}`);
    } else if (as === 'sl') {
      const body: Record<string, unknown> = { hard_stop: p, sl_enabled: true };
      if (flipped && editKey) body.tp_rungs = otherUser;      // the TP line becomes the stop
      submit(body, `Stop set at $${p.toFixed(2)}${sp != null ? ` (≈ ${sp.toFixed(2)})` : ''} — sells all remaining`);
    } else if (editKey === 'tp1' || editKey === 'tp2') {
      // Send the stepper's qty too — it was shown but dropped (thread 9).
      submit({ [editKey]: p, [`${editKey}_qty`]: qty },
        `${editRung?.label ?? 'TP'} moved to $${p.toFixed(2)} · ${qty} contract${qty === 1 ? '' : 's'}`);
    } else {
      const mine: TpRungInput = { id: editKey ?? undefined, premium: p, qty, stock_price: sp,
                                  source: editRung ? (editRung.source as TpRungInput['source']) : 'chart-long-press' };
      submit({ tp_rungs: [...otherUser, mine], ...(immediate ? { allow_immediate: true } : {}) }, `TP set at $${p.toFixed(2)}${sp != null ? ` (≈ ${sp.toFixed(2)})` : ''}, sells ${qty}`);
    }
  };

  const onDelete = () => {
    if (!trade || !editKey) return;
    if (editKey === 'sl') {
      if (confirmArmed !== 'delete-sl') { setConfirmArmed('delete-sl'); return; }
      submit({ sl_enabled: false }, 'Stop-loss removed — no stop is active');
      return;
    }
    submit({ tp_rungs: otherUser }, 'TP line removed — its contracts return to the runner');
  };

  if (!visible) return null;
  const isNew = request!.mode === 'new';
  const lineName = editRung?.label ?? (editKey === 'sl' ? 'SL' : editKey === 'be' ? 'BE' : '');
  const effective: Kind = flipped ? 'sl' : kind;
  const pctN = parseFloat(pctText);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[s.grab, { backgroundColor: colors.border }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            <View style={s.rowBetween}>
              <Text style={[s.title, { color: colors.text }]}>
                {isNew ? 'Exit at this price' : `${lineName} line`}
              </Text>
              <Text style={[s.tag, { color: colors.textSecondary, borderColor: colors.border }]}>
                {isNew ? `smart default: ${kind.toUpperCase()}` : editIsUser ? 'chart line' : editKey === 'tp1' || editKey === 'tp2' ? 'engine level' : 'stop'}
              </Text>
            </View>

            {/* Which contract — only when there's a choice (§4.6). */}
            {trades.length > 1 && request!.mode === 'new' ? (
              <View style={s.wrapRow}>
                {trades.map(t => (
                  <Pressable key={t.strategyId} onPress={() => pickTrade(t)}
                    style={[s.choice, { borderColor: t === trade ? colors.text : colors.border }]}>
                    <Text style={{ color: t === trade ? colors.text : colors.textSecondary, fontSize: 12, fontWeight: '600' }}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{trade?.label}</Text>
            )}

            {isNew ? (
              <View style={s.wrapRow}>
                {(['tp', 'sl'] as Kind[]).map(k => (
                  <Pressable key={k} onPress={() => { setKind(k); setConfirmArmed(null); }}
                    style={[s.choice, { borderColor: kind === k ? (k === 'tp' ? colors.success : colors.error) : colors.border }]}>
                    <Text style={{ color: kind === k ? colors.text : colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{k === 'tp' ? 'Take profit' : 'Stop loss'}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={s.inputs}>
              <Field label="Stock price" value={stockText} onChange={onStock} editable={convOK} colors={colors} prefix="$" />
              <Field label={convOK ? '≈ Premium' : 'Premium'} value={premText} onChange={onPrem} colors={colors} prefix="$" />
              <Field label="vs entry" value={pctText} onChange={onPct} colors={colors} suffix="%"
                tone={isNum(pctN) ? (pctN >= 0 ? colors.success : colors.error) : undefined} />
            </View>
            <Text style={[s.note, { color: convOK ? colors.textTertiary : colors.warning }]}>
              {convOK ? deltaLabel(deltaInfo) : `${ud.reason ?? (u == null ? 'no underlying price' : 'no live premium')} — showing premium only`}
              {'  ·  '}executes on the premium, never the stock price
            </Text>

            {!isNew ? (
              <View style={s.wrapRow}>
                <Btn label="−$0.05" onPress={() => nudge(-0.05)} colors={colors} disabled={!convOK} />
                <Btn label="+$0.05" onPress={() => nudge(0.05)} colors={colors} disabled={!convOK} />
              </View>
            ) : null}

            {effective === 'tp' ? (
              <View style={s.rowBetween}>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Sell</Text>
                <View style={s.stepper}>
                  <Btn label="−" onPress={() => setQty(q => Math.max(1, q - 1))} colors={colors} />
                  <Text style={{ color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{qty} of {qtyRem}</Text>
                  <Btn label="+" onPress={() => setQty(q => Math.min(qtyCap, q + 1))} colors={colors} />
                </View>
              </View>
            ) : null}

            <Text style={[s.note, { color: colors.textSecondary }]}>
              {effective === 'sl' ? 'A stop sells ALL remaining contracts when hit.'
                : effective === 'be' ? (editKey === 'be'
                  ? `Moves the stop (now $${fmt(live?.hard_stop)}) to this price — sells all remaining if hit.`
                  : `Stop moves to breakeven ($${entry.toFixed(2)} premium).`)
                : carves ? `Takes ${carves} of TP1's ${tp1!.qty} — TP1 then sells ${tp1!.qty - carves}${tp1!.qty - carves === 0 ? ' (this line becomes TP1)' : ''}.`
                : editRung ? `Moves ${editRung.label}; the ladder re-sorts by premium.`
                : `New TP row; reserves ${qty} contract${qty === 1 ? '' : 's'} — the last contract stays the runner.`}
            </Text>

            {flipped ? <Text style={[s.warn, { color: colors.warning }]}>Dragged past the current price — this saves as a stop-loss instead of a TP.</Text> : null}
            {immediate ? <Text style={[s.warn, { color: colors.warning }]}>This level is already reached — it will fire on the next tick.{confirmArmed === 'immediate' ? ' Tap Set TP again to confirm.' : ''}</Text> : null}
            {confirmArmed === 'delete-sl' ? <Text style={[s.warn, { color: colors.error }]}>No stop-loss will be active. Tap Delete again to confirm.</Text> : null}
            {problem ? <Text style={[s.warn, { color: colors.error }]}>{problem}</Text> : null}

            <View style={s.wrapRow}>
              {snapToBE ? <Btn label="Snap to BE" onPress={() => onSave('be')} colors={colors} /> : null}
              <Btn label={effective === 'sl' ? 'Set SL' : effective === 'be' ? 'Move stop here' : 'Set TP'} primary
                tone={effective === 'tp' ? colors.success : effective === 'be' ? colors.textSecondary : colors.error}
                onPress={() => onSave(effective)} colors={colors} disabled={!!problem || save.isPending} />
              {editKey === 'be' ? <Btn label="Reset to breakeven" onPress={() => {
                if (trade) submit({ hard_stop: round2(entry), sl_enabled: true }, `Stop set to breakeven $${entry.toFixed(2)}`);
              }} colors={colors} /> : null}
              {isNew ? (
                <>
                  <Btn label={kind === 'tp' ? 'Set SL' : 'Set TP'} onPress={() => { setKind(kind === 'tp' ? 'sl' : 'tp'); }} colors={colors} />
                  <Btn label="Set alert instead" onPress={() => { if (stockOK) { close(); onSetAlert(round2(stock)); } }} colors={colors} />
                </>
              ) : (editIsUser || editKey === 'sl') ? (
                <Btn label={editKey === 'sl' ? 'Delete SL' : 'Delete TP'} onPress={onDelete} colors={colors} tone={colors.error} />
              ) : null}
              <Btn label="Cancel" onPress={close} colors={colors} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChange, colors, editable = true, prefix, suffix, tone }: {
  label: string; value: string; onChange: (t: string) => void; colors: any; editable?: boolean;
  prefix?: string; suffix?: string; tone?: string;
}) {
  return (
    <View style={[s.field, { borderColor: colors.border, backgroundColor: colors.background, opacity: editable ? 1 : 0.5 }]}>
      <Text style={[s.fieldLabel, { color: colors.textTertiary }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {prefix ? <Text style={[s.fieldText, { color: colors.textSecondary }]}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          editable={editable}
          keyboardType="decimal-pad"
          style={[s.fieldText, { color: tone ?? colors.text, flex: 1, padding: 0 }]}
          accessibilityLabel={label}
        />
        {suffix ? <Text style={[s.fieldText, { color: colors.textSecondary }]}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function Btn({ label, onPress, colors, primary, tone, disabled }: {
  label: string; onPress: () => void; colors: any; primary?: boolean; tone?: string; disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[s.btn, primary
        ? { backgroundColor: tone ?? colors.success, borderColor: tone ?? colors.success }
        : { borderColor: tone ?? colors.border }, disabled && { opacity: 0.45 }]}>
      <Text style={{ color: primary ? '#0A0B0F' : (tone ?? colors.text), fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, maxHeight: 560 },
  grab: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  tag: { fontSize: 11, fontWeight: '600', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  inputs: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, minWidth: 0 },
  fieldLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  fieldText: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  note: { fontSize: 11.5, lineHeight: 16 },
  warn: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
});
