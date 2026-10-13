import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, ActivityIndicator, Easing, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { accountModeColor } from './AccountModeBanner';

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

function formatExpiryShort(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : iso;
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
   *  below the Enter button, confirmed with its own Alert since it's
   *  a real "trust the last-polled price, not a live tick" decision.
   *  Omitted entirely when the parent doesn't support it (e.g. not a 0DTE
   *  contract, where the backend never does the stream check anyway). */
  onEnterBlind?: () => void;
  /** Set by the parent once the order succeeds — plays the confirmation
   *  animation with this message, then calls onSuccessDone. */
  successMessage: string | null;
  /** Called after the success animation finishes; the parent closes here. */
  onSuccessDone: () => void;
  /** Optional line under the success copy, e.g. "Taking you to your position…". */
  successHint?: string;
  colors: any;
}

// Two-tap enter: the first tap arms ("Confirm"), the second submits. An
// armed button falls back to "Enter" after this long with no second tap.
const ARM_TIMEOUT_MS = 4000;
const SUCCESS_HOLD_MS = 1700; // how long the success state shows before closing (mock: 1.7s)
// How long "Submitting…" shows before swapping to "Checking live price
// feed…" — shorter than the backend's 8s stream-verify window so the
// message changes while the user is still watching, not right as it's
// about to time out.
const SUBMIT_LABEL_DELAY_MS = 2000;

export function OrderReviewSheet({
  visible, order, paperMode, check, overridden, warnings, isSubmitting, onSubmit, onCancel,
  onEnterBlind, successMessage, onSuccessDone, successHint, colors,
}: Props) {
  const slide = useRef(new Animated.Value(1)).current;  // 1 = off-screen, 0 = shown
  const fired = useRef(false);
  // First tap arms the button ("Confirm"); the second tap submits.
  const [armed, setArmed] = useState(false);
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!armed) return;
    pop.setValue(0.94);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed, pop]);
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const muted = colors.textSecondary ?? colors.tabBarInactive;
  const modeColor = accountModeColor(paperMode, colors);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : 1, duration: visible ? 260 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true,
    }).start();
    if (visible) {
      setArmed(false);
      successScale.setValue(0);
      successOpacity.setValue(0);
      fired.current = false;
    }
  }, [visible]);

  // An order that failed (or went to Blind Entry) resets to a fresh "Enter".
  useEffect(() => {
    if (!isSubmitting && fired.current && !successMessage) {
      fired.current = false;
      setArmed(false);
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
    successOpacity.setValue(1);  // replaces "Entering…" in place — no fade-from-blank
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
    ]).start();
    const id = setTimeout(onSuccessDone, SUCCESS_HOLD_MS);
    return () => clearTimeout(id);
  }, [successMessage]);

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

  // Confirm rows (entry-flow mock, stage 3).
  const cp = order.optionType === 'CALL' ? 'C' : 'P';
  const strikeTxt = order.strike.toFixed(2);
  const maxCost = order.premium * order.qty * 100;
  const ladderTxt = order.profileLabel.startsWith('Ladder · ')
    ? order.profileLabel.slice('Ladder · '.length)
    : [order.profileLabel,
       ...(order.tp1Price != null ? [`TP ${money(order.tp1Price)}`] : []),
       ...(order.tp2Price != null ? [money(order.tp2Price)] : [])].join(' · ');
  const stopTxt = order.stopPrice == null
    ? 'Off'
    : `−${Math.round((1 - order.stopPrice / order.premium) * 100)}% · ${money(order.stopPrice)}` +
      (order.stopLabel && order.stopLabel !== 'Hard stop' && order.stopLabel !== 'Off' ? ` · ${order.stopLabel}` : '');
  // Anything the trader should still see at the last gate — an overridden
  // DON'T ENTER plus the parent's warnings (no stop, other live positions).
  const notes = [
    ...(check?.verdict.decision === 'DONT_ENTER' && overridden ? ["Technicals say DON'T ENTER — overridden."] : []),
    ...warnings,
  ];
  const green = colors.success;

  // Two taps, paper and LIVE alike: "Enter" → "Confirm" (button changes
  // color) → submit. Kareem 2026-10-13, replacing press-and-hold.
  const tapEnter = () => {
    if (fired.current || isSubmitting || successMessage) return;
    if (!armed) {
      setArmed(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    fired.current = true;
    setArmed(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    onSubmit();
  };
  // Enter = solid green; armed Confirm = solid amber (paper) / red (LIVE —
  // real money), white text, so the two states can't be mistaken.
  const confirmBg = paperMode ? '#F59E0B' : colors.error;
  const btnBg = armed ? confirmBg : green;
  const btnFg = armed ? '#fff' : '#06240f';
  const btnLabel = armed
    ? `${paperMode ? 'Confirm' : 'Confirm LIVE'} · ${money(maxCost)}`
    : `${paperMode ? 'Enter' : 'Enter LIVE'} · ${money(maxCost)}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={isSubmitting ? undefined : onCancel} />
      </Animated.View>

      <Animated.View style={[
        s.sheet,
        { backgroundColor: colors.card ?? colors.background, borderColor: colors.border,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 800] }) }] },
      ]}>
        <View style={[s.grabber, { backgroundColor: (colors.textTertiary ?? muted) + '66' }]} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8 }} bounces={false}>
          <Text style={[s.title, { color: colors.text }]}>Confirm order</Text>
          <Text style={[s.sub, { color: muted }]}>Last check before it goes out.</Text>

          <Row k="Contract" v={`${order.ticker} $${strikeTxt}${cp} · ${formatExpiryShort(order.expiration)}`} colors={colors} />
          <Row k="Side / Qty" v={`Buy ${order.qty} ${order.optionType}`} colors={colors} />
          <Row k="Est. premium" v={money(order.premium)} colors={colors} />
          <Row k="Max cost" v={money(maxCost)} colors={colors} />
          <Row k="Ladder" v={ladderTxt} colors={colors} />
          <Row k="Stop" v={stopTxt} color={order.stopPrice == null ? muted : colors.error} colors={colors} />
          <Row k="Account" v={paperMode ? 'PAPER' : 'LIVE'} color={modeColor} colors={colors} last />

          {notes.map(w => (
            <View key={w} style={s.warningRow}>
              <Ionicons name="warning" size={13} color={colors.warning} />
              <Text style={[s.warningText, { color: colors.warning }]}>{w}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={[s.ctaBar, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={tapEnter}
            disabled={isSubmitting || !!successMessage}
            accessibilityRole="button"
            accessibilityLabel={btnLabel}
          >
            {({ pressed }) => (
              // Styled on an inner Animated.View (not Pressable's style
              // callback) so the solid fill, ring and shadow always render.
              <Animated.View
                style={[
                  s.enterBtn,
                  {
                    backgroundColor: isSubmitting ? green : btnBg,
                    borderColor: armed && !isSubmitting ? '#ffffff55' : 'transparent',
                    shadowColor: isSubmitting ? green : btnBg,
                    opacity: pressed ? 0.88 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }, { scale: pop }],
                  },
                ]}
              >
                {isSubmitting ? (
                  <View style={s.btnRow}>
                    <ActivityIndicator color="#06240f" />
                    <Text style={[s.enterText, { color: '#06240f' }]}>{submitLabel}</Text>
                  </View>
                ) : (
                  <View style={s.btnRow}>
                    <Ionicons
                      name={armed ? 'checkmark-circle' : 'arrow-forward-circle'}
                      size={21}
                      color={btnFg}
                    />
                    <Text style={[s.enterText, { color: btnFg }]}>{btnLabel}</Text>
                  </View>
                )}
              </Animated.View>
            )}
          </Pressable>
          <Pressable onPress={onCancel} disabled={isSubmitting} hitSlop={6} style={s.backBtn}>
            <Text style={[s.backText, { color: muted }]}>Back</Text>
          </Pressable>

          {/* Opt into skipping the live-tick check upfront — see onEnterBlind's
              doc comment. Only passed for a 0DTE contract. */}
          {onEnterBlind && !isSubmitting && !successMessage && (
            <Pressable onPress={handleEnterBlind} hitSlop={8} style={s.blindLink}>
              <Ionicons name="flash-outline" size={13} color={muted} />
              <Text style={[s.blindLinkText, { color: muted }]}>Skip live price check</Text>
            </Pressable>
          )}
        </View>

        {/* Entering → Entered (stage 4). The full-sheet state takes over the
            moment Confirm is tapped: "Entering…" with a spinner while the
            order is in flight (a 0DTE / after-hours submit can spend ~8s on
            the live-price check), then the check + "Entered" on success and
            on to Home. On failure it drops away, back to Confirm (error
            toast from the parent). */}
        {isSubmitting && !successMessage && (
          <View style={[StyleSheet.absoluteFill, s.successWrap, { backgroundColor: colors.background }]}>
            <View style={[s.successRing, { backgroundColor: green + '10', borderColor: green + '66' }]}>
              <ActivityIndicator size="large" color={green} />
            </View>
            <Text style={[s.successTitle, { color: colors.text }]}>Entering…</Text>
            <Text style={[s.successLine, { color: colors.textSecondary ?? muted }]}>
              {order.ticker} ${strikeTxt}{cp} ×{order.qty} @ {money(order.premium)}
            </Text>
            <Text style={[s.successMode, { color: modeColor }]}>{paperMode ? 'PAPER' : 'LIVE'}</Text>
            <Text style={[s.successHint, { color: muted }]}>{submitLabel}</Text>
            <ProgressSweep color={green} track={colors.border} />
          </View>
        )}
        {successMessage && (
          <Animated.View style={[StyleSheet.absoluteFill, s.successWrap, { backgroundColor: colors.background, opacity: successOpacity }]}>
            <Animated.View style={[s.successRing, { backgroundColor: green + '18', borderColor: green, transform: [{ scale: successScale }] }]}>
              <Ionicons name="checkmark" size={46} color={green} />
            </Animated.View>
            <Text style={[s.successTitle, { color: colors.text }]}>Entered</Text>
            <Text style={[s.successLine, { color: colors.textSecondary ?? muted }]}>
              {order.ticker} ${strikeTxt}{cp} ×{order.qty} @ {money(order.premium)}
            </Text>
            <Text style={[s.successMode, { color: modeColor }]}>{paperMode ? 'PAPER' : 'LIVE'}</Text>
            {successHint ? (
              <>
                <Text style={[s.successHint, { color: muted }]}>{successHint}</Text>
                <ProgressSweep color={green} track={colors.border} />
              </>
            ) : null}
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

function Row({ k, v, color, colors, last }: { k: string; v: string; color?: string; colors: any; last?: boolean }) {
  return (
    <View style={[s.row, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
      <Text style={[s.rowK, { color: colors.textSecondary ?? colors.tabBarInactive }]}>{k}</Text>
      <Text style={[s.rowV, { color: color ?? colors.text }]} numberOfLines={1}>{v}</Text>
    </View>
  );
}

/** Indeterminate sliding bar under "Taking you to your position…". */
function ProgressSweep({ color, track }: { color: string; track: string }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [x]);
  return (
    <View style={[s.bar, { backgroundColor: track }]}>
      <Animated.View
        style={[s.barFill, { backgroundColor: color,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-72, 180] }) }] }]}
      />
    </View>
  );
}


const s = StyleSheet.create({
  backdrop:     { backgroundColor: '#000' },
  sheet:        { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, overflow: 'hidden' },
  grabber:      { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 8, marginBottom: 10 },
  title:        { fontSize: 18, fontWeight: '800' },
  sub:          { fontSize: 12.5, marginTop: 3, marginBottom: 10 },

  row:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 10 },
  rowK:         { fontSize: 13.5 },
  rowV:         { fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },

  warningRow:   { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 10 },
  warningText:  { fontSize: 12.5, flex: 1, lineHeight: 17, fontWeight: '600' },

  ctaBar:       { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 26 },
  enterBtn:     {
    height: 56, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  btnRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  enterText:    { fontSize: 16.5, fontWeight: '800', letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  backBtn:      { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  backText:     { fontSize: 13.5, fontWeight: '700' },
  blindLink:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4 },
  blindLinkText: { fontSize: 11.5, fontWeight: '600', textDecorationLine: 'underline' },

  successWrap:  { alignItems: 'center', justifyContent: 'center', padding: 32 },
  successRing:  { width: 92, height: 92, borderRadius: 46, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 24, fontWeight: '800', marginTop: 20 },
  successLine:  { fontSize: 15, marginTop: 8, fontVariant: ['tabular-nums'] },
  successMode:  { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
  successHint:  { fontSize: 13, marginTop: 28 },
  bar:          { width: 180, height: 4, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  barFill:      { width: 72, height: 4, borderRadius: 3 },
});
