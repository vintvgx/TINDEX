import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, ActivityIndicator, Easing, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { verdictColor, verdictLabel } from './EntryTechnicalsPanel';
import { accountModeColor } from './AccountModeBanner';
import { ExitPlanLadder } from '@/common/components/trade/ExitPlanLadder';

export interface ReviewOrder {
  ticker: string;
  optionType: 'CALL' | 'PUT';
  strike: number;
  expiration: string;          // YYYY-MM-DD
  premium: number;             // per-share ask the order will be priced off
  qty: number;
  profileLabel: string;        // e.g. "⚡ Scalper"
  stopPrice: number | null;    // null = no automatic stop
  stopLabel: string;           // "Hard stop" | "5-min SL timer" | "Off"
  tp1Price: number | null;
  tp2Price: number | null;
  /** Worst-case floor price (null = none) and whether it's the stop type's
   *  default rather than a choice made on the entry sheet. */
  floorPrice?: number | null;
  floorIsDefault?: boolean;
  /** Post-TP1 breakeven grace, seconds (0 = none). */
  beGraceSeconds?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatExpiry(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Plain-English summary + risk numbers for a long call/put — pure, so it's easy to sanity-check. */
export function buildOrderSummary(o: ReviewOrder) {
  const isCall = o.optionType === 'CALL';
  const shares = o.qty * 100;
  const cost = o.premium * shares;
  const strike = money(o.strike);
  const shareText = o.qty === 1 ? '100 shares' : `${shares.toLocaleString('en-US')} shares (${o.qty} contracts)`;
  const summary =
    `You're paying ${money(cost)} for the right to ${isCall ? 'buy' : 'sell'} ${shareText} of ${o.ticker} ` +
    `at ${strike} by ${formatExpiry(o.expiration)}. ` +
    `If ${o.ticker} isn't ${isCall ? 'above' : 'below'} ${strike} at expiration, it expires worthless.`;
  const breakeven = isCall ? o.strike + o.premium : o.strike - o.premium;
  const maxProfit = isCall ? null : Math.max(0, (o.strike - o.premium) * shares);
  return { summary, cost, maxLoss: cost, breakeven, maxProfit };
}

interface Props {
  visible: boolean;
  order: ReviewOrder;
  paperMode: boolean;
  check: EntryCheck | undefined;
  overridden: boolean;
  warnings: string[];
  isSubmitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  /** Lets the trader skip the backend's 8s live-tick verification upfront
   *  (same effect as confirming the BlindEntryModal that appears
   *  automatically on a stream_unavailable result, just opted into before
   *  submitting instead of after a timeout) — shown as a secondary option
   *  below the main hold button, confirmed with its own Alert since it's
   *  a real "trust the last-polled price, not a live tick" decision.
   *  Omitted entirely when the parent doesn't support it (e.g. not a 0DTE
   *  contract, where the backend never does the stream check anyway). */
  onEnterBlind?: () => void;
  /** Set by the parent once the order succeeds — plays the confirmation
   *  animation with this message, then calls onSuccessDone. */
  successMessage: string | null;
  /** Called after the success animation finishes; the parent closes here. */
  onSuccessDone: () => void;
  colors: any;
}

const HOLD_MS = 1200;        // how long the button must be held to submit
const SUCCESS_HOLD_MS = 1500; // how long the success state shows before closing
// How long "Submitting…" shows before swapping to "Checking live price
// feed…" — shorter than the backend's 8s stream-verify window so the
// message changes while the user is still watching, not right as it's
// about to time out.
const SUBMIT_LABEL_DELAY_MS = 2000;

export function OrderReviewSheet({
  visible, order, paperMode, check, overridden, warnings, isSubmitting, onSubmit, onCancel,
  onEnterBlind, successMessage, onSuccessDone, colors,
}: Props) {
  const slide = useRef(new Animated.Value(1)).current;  // 1 = off-screen, 0 = shown
  const hold = useRef(new Animated.Value(0)).current;   // 0 → 1 while held
  const holdAnim = useRef<Animated.CompositeAnimation | null>(null);
  // Current fill level, so a re-press mid-rewind only takes the remaining time.
  const holdLevel = useRef(0);
  useEffect(() => {
    const id = hold.addListener(({ value }) => { holdLevel.current = value; });
    return () => hold.removeListener(id);
  }, []);
  const fired = useRef(false);
  const [holding, setHolding] = useState(false);
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const muted = colors.textSecondary ?? colors.tabBarInactive;
  const modeColor = accountModeColor(paperMode, colors);
  const { summary, maxLoss, breakeven, maxProfit } = useMemo(() => buildOrderSummary(order), [order]);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : 1, duration: visible ? 260 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true,
    }).start();
    if (visible) {
      hold.setValue(0);
      successScale.setValue(0);
      successOpacity.setValue(0);
      fired.current = false;
    }
  }, [visible]);

  // An order that failed (or went to Blind Entry) resets for a fresh hold.
  useEffect(() => {
    if (!isSubmitting && fired.current && !successMessage) {
      fired.current = false;
      Animated.timing(hold, { toValue: 0, duration: 200, useNativeDriver: false }).start();
    }
  }, [isSubmitting]);

  // A 0DTE submit's first ~8s is the backend's live-tick verification, not
  // a generic "placing the order" wait — a bare "Submitting…" the whole
  // time reads as stuck well before the backend has actually given up
  // (see docs/todos/OUTSTANDING.md's paper-trade-hang debugging session).
  // Swapping the label after a short delay costs nothing when the order
  // places quickly (most non-0DTE submits, and every blind-entry retry,
  // settle before this ever shows) and gives an honest in-progress signal
  // on the slow path instead of silence.
  const [submitLabel, setSubmitLabel] = useState('Submitting…');
  useEffect(() => {
    if (!isSubmitting) {
      setSubmitLabel('Submitting…');
      return;
    }
    const id = setTimeout(() => setSubmitLabel('Checking live price feed…'), SUBMIT_LABEL_DELAY_MS);
    return () => clearTimeout(id);
  }, [isSubmitting]);

  // Success: pop a check mark in, pause so it registers, then hand back to
  // the parent to close the sheet(s).
  useEffect(() => {
    if (!successMessage) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Animated.parallel([
      Animated.timing(successOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(successScale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
    ]).start();
    const id = setTimeout(onSuccessDone, SUCCESS_HOLD_MS);
    return () => clearTimeout(id);
  }, [successMessage]);

  const startHold = () => {
    if (fired.current || isSubmitting || successMessage) return;
    setHolding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    holdAnim.current = Animated.timing(hold, {
      toValue: 1, duration: HOLD_MS * (1 - holdLevel.current), easing: Easing.linear, useNativeDriver: false,
    });
    holdAnim.current.start(({ finished }) => {
      if (!finished) return;
      fired.current = true;
      setHolding(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      onSubmit();
    });
  };

  const cancelHold = () => {
    setHolding(false);
    if (fired.current) return;
    holdAnim.current?.stop();
    Animated.timing(hold, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  };

  const handleEnterBlind = () => {
    if (!onEnterBlind || isSubmitting || successMessage) return;
    Alert.alert(
      'Skip the live price check?',
      `This enters off the last polled price (${money(order.premium)}) instead of waiting ` +
      `to confirm a live tick — it may be a few seconds stale. Same confirmation you'd get ` +
      `automatically if the live check timed out, just upfront.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Enter Anyway', style: 'destructive', onPress: onEnterBlind },
      ],
    );
  };

  const vDecision = check?.verdict.decision;
  const vColor = verdictColor(vDecision, colors);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={isSubmitting ? undefined : onCancel} />
      </Animated.View>

      <Animated.View style={[
        s.sheet,
        { backgroundColor: colors.background, borderColor: modeColor,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 800] }) }] },
      ]}>
        <View style={[s.modeStrip, { backgroundColor: modeColor }]}>
          <Text style={s.modeStripText}>{paperMode ? 'PAPER ORDER · simulated' : 'LIVE ORDER · real money'}</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 8 }} bounces={false}>
          <View style={s.titleRow}>
            <Text style={[s.title, { color: colors.text }]}>Review order</Text>
            <Pressable onPress={onCancel} disabled={isSubmitting} hitSlop={10}>
              <Text style={[s.edit, { color: muted }]}>Edit</Text>
            </Pressable>
          </View>
          <Text style={[s.contract, { color: muted }]}>
            {order.ticker} ${order.strike} {order.optionType} · {formatExpiry(order.expiration)} · {order.qty} × {money(order.premium)}
          </Text>

          <Text style={[s.summary, { color: colors.text }]}>{summary}</Text>

          <View style={[s.stats, { borderColor: colors.border }]}>
            <Stat label="Max loss" value={money(maxLoss)} color={colors.error} colors={colors} />
            <Stat label="Breakeven" value={money(breakeven)} colors={colors} />
            <Stat label="Max profit" value={maxProfit == null ? 'Unlimited' : money(maxProfit)} color={colors.success} colors={colors} />
          </View>

          <Text style={[s.section, { color: muted }]}>EXIT PLAN · {order.profileLabel}</Text>
          <ExitPlanLadder
            colors={colors}
            plan={{
              premium: order.premium, qty: order.qty,
              stopPrice: order.stopPrice, stopLabel: order.stopLabel,
              floorPrice: order.floorPrice ?? null, floorIsDefault: order.floorIsDefault,
              beGraceSeconds: order.beGraceSeconds ?? 0,
              tp1Price: order.tp1Price, tp2Price: order.tp2Price,
            }}
          />
          <Text style={[s.fineprint, { color: muted }]}>Levels are estimated from the {money(order.premium)} ask; final levels are set from your fill price.</Text>

          <View style={[s.verdictRecap, { backgroundColor: vColor + '1A', borderColor: vColor + '55' }]}>
            <Text style={[s.verdictRecapText, { color: vColor }]} numberOfLines={3}>
              {check
                ? `${verdictLabel(check.verdict.decision)}${overridden && vDecision === 'DONT_ENTER' ? ' (overridden)' : ''} — ${check.verdict.reason.replace(/^(ENTER|WAIT|DON'T ENTER) — /, '')}`
                : 'No technicals verdict for this entry.'}
            </Text>
          </View>

          {warnings.map(w => (
            <View key={w} style={s.warningRow}>
              <Ionicons name="warning" size={14} color={colors.warning} />
              <Text style={[s.warningText, { color: colors.warning }]}>{w}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Press-and-hold to submit */}
        <View style={[s.holdWrap, { borderTopColor: colors.border }]}>
          <Pressable
            onPressIn={startHold}
            onPressOut={cancelHold}
            disabled={isSubmitting || !!successMessage}
            style={[s.holdBtn, { borderColor: modeColor, backgroundColor: modeColor + '22' }]}
          >
            <Animated.View
              style={[s.holdFill, {
                backgroundColor: modeColor,
                width: hold.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }]}
            />
            {isSubmitting ? (
              <View style={s.holdLabelRow}>
                <ActivityIndicator color="#fff" />
                <Text style={[s.holdText, { color: '#fff' }]}>{submitLabel}</Text>
              </View>
            ) : (
              <View style={s.holdLabelRow}>
                <Ionicons name="finger-print" size={20} color={holding ? '#fff' : modeColor} />
                <Text style={[s.holdText, { color: holding ? '#fff' : modeColor }]}>
                  {holding ? 'Keep holding…' : `Hold to ${paperMode ? 'submit paper order' : 'submit LIVE order'}`}
                </Text>
              </View>
            )}
          </Pressable>
          <Text style={[s.holdHint, { color: muted }]}>Release early to cancel</Text>

          {/* Opt into skipping the live-tick check upfront instead of
              waiting out the 8s backend check and getting the same choice
              as a fallback (BlindEntryModal) — see onEnterBlind's doc
              comment. Hidden once submitting/succeeded, same as the main
              button; the parent only passes this at all for a 0DTE
              contract (where the backend's stream check — and therefore
              this bypass — actually means something). */}
          {onEnterBlind && !isSubmitting && !successMessage && (
            <Pressable onPress={handleEnterBlind} hitSlop={8} style={s.blindLink}>
              <Ionicons name="flash-outline" size={13} color={muted} />
              <Text style={[s.blindLinkText, { color: muted }]}>Skip live price check</Text>
            </Pressable>
          )}
        </View>

        {/* Success confirmation */}
        {successMessage && (
          <Animated.View style={[StyleSheet.absoluteFill, s.successWrap, { backgroundColor: colors.background, opacity: successOpacity }]}>
            <Animated.View style={[s.successCircle, { backgroundColor: colors.success, transform: [{ scale: successScale }] }]}>
              <Ionicons name="checkmark" size={56} color="#fff" />
            </Animated.View>
            <Text style={[s.successTitle, { color: colors.text }]}>
              {paperMode ? 'Paper order placed' : 'Order placed'}
            </Text>
            <Text style={[s.successSub, { color: muted }]}>
              {order.qty} × {order.ticker} ${order.strike} {order.optionType}
            </Text>
            <Text style={[s.successSub, { color: muted }]} numberOfLines={2}>{successMessage}</Text>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

function Stat({ label, value, color, colors }: { label: string; value: string; color?: string; colors: any }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statLabel, { color: colors.textSecondary ?? colors.tabBarInactive }]}>{label}</Text>
      <Text style={[s.statValue, { color: color ?? colors.text }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop:     { backgroundColor: '#000' },
  sheet:        { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 2, borderBottomWidth: 0, overflow: 'hidden' },
  modeStrip:    { paddingVertical: 6, alignItems: 'center' },
  modeStripText:{ color: '#fff', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },

  titleRow:     { flexDirection: 'row', alignItems: 'center' },
  title:        { fontSize: 20, fontWeight: '800' },
  edit:         { marginLeft: 'auto', fontSize: 14, fontWeight: '600' },
  contract:     { fontSize: 13, marginTop: 3 },
  summary:      { fontSize: 15, lineHeight: 22, marginTop: 14 },

  stats:        { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 16, paddingVertical: 12 },
  stat:         { flex: 1 },
  statLabel:    { fontSize: 11.5 },
  statValue:    { fontSize: 15, fontWeight: '700', marginTop: 3 },

  section:      { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  exitCard:     { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  exitLine:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  exitLabel:    { fontSize: 13.5, fontWeight: '500' },
  exitValue:    { fontSize: 13.5, fontWeight: '700', marginLeft: 'auto' },
  fineprint:    { fontSize: 11, marginTop: 6 },

  verdictRecap: { borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 14 },
  verdictRecapText: { fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  warningRow:   { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 8 },
  warningText:  { fontSize: 12.5, flex: 1, lineHeight: 17, fontWeight: '600' },

  holdWrap:     { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 30 },
  holdBtn:      { height: 58, borderRadius: 14, borderWidth: 1.5, overflow: 'hidden', justifyContent: 'center' },
  holdFill:     { position: 'absolute', left: 0, top: 0, bottom: 0 },
  holdLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  holdText:     { fontSize: 15.5, fontWeight: '800' },
  holdHint:     { fontSize: 11.5, textAlign: 'center', marginTop: 8 },
  blindLink:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 10, paddingVertical: 4 },
  blindLinkText: { fontSize: 11.5, fontWeight: '600', textDecorationLine: 'underline' },

  successWrap:  { alignItems: 'center', justifyContent: 'center', padding: 24 },
  successCircle:{ width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  successTitle: { fontSize: 22, fontWeight: '800' },
  successSub:   { fontSize: 14, marginTop: 6, textAlign: 'center' },
});
