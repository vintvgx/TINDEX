import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, Pressable, ActivityIndicator, Easing, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { verdictColor, verdictLabel } from './EntryTechnicalsPanel';
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
  colors: any;
}

const TRACK = 150;       // how far the handle travels
const THRESHOLD = 0.8;   // fraction of TRACK that counts as a submit

export function OrderReviewSheet({
  visible, order, paperMode, check, overridden, warnings, isSubmitting, onSubmit, onCancel, colors,
}: Props) {
  const slide = useRef(new Animated.Value(1)).current;  // 1 = off-screen, 0 = shown
  const drag = useRef(new Animated.Value(0)).current;   // 0 → -TRACK
  const fired = useRef(false);
  // Read through a ref so the PanResponder is built once — a parent
  // re-render mid-swipe must not swap handlers out from under the gesture.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const muted = colors.textSecondary ?? colors.tabBarInactive;
  const modeColor = accountModeColor(paperMode, colors);
  const { summary, maxLoss, breakeven, maxProfit } = useMemo(() => buildOrderSummary(order), [order]);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : 1, duration: visible ? 260 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true,
    }).start();
    if (visible) { drag.setValue(0); fired.current = false; }
  }, [visible]);

  // An order that failed (or went to Blind Entry) drops back to a fresh swipe.
  useEffect(() => {
    if (!isSubmitting && fired.current) {
      fired.current = false;
      Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
    }
  }, [isSubmitting]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !fired.current,
    onMoveShouldSetPanResponder: (_, g) => !fired.current && Math.abs(g.dy) > 4,
    onPanResponderMove: (_, g) => drag.setValue(Math.max(-TRACK, Math.min(0, g.dy))),
    onPanResponderRelease: (_, g) => {
      if (-g.dy >= TRACK * THRESHOLD) {
        fired.current = true;
        Animated.timing(drag, { toValue: -TRACK, duration: 120, useNativeDriver: true }).start();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onSubmitRef.current();
      } else {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
  }), []);

  const progress = drag.interpolate({ inputRange: [-TRACK, 0], outputRange: [1, 0], extrapolate: 'clamp' });
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
          <View style={[s.exitCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ExitLine label={order.stopLabel === 'Off' ? 'Stop loss' : order.stopLabel}
              value={order.stopPrice == null ? 'Off — no automatic stop' : `≈ ${money(order.stopPrice)}  (−${money((order.premium - order.stopPrice) * order.qty * 100)})`}
              color={order.stopPrice == null ? colors.warning : colors.error} colors={colors} />
            <ExitLine label="Take profit 1"
              value={order.tp1Price == null ? 'Off' : `≈ ${money(order.tp1Price)}  (+${money((order.tp1Price - order.premium) * order.qty * 100)})`}
              color={colors.success} colors={colors} />
            {order.tp2Price != null && (
              <ExitLine label="Take profit 2" value={`≈ ${money(order.tp2Price)}`} color={colors.success} colors={colors} last />
            )}
          </View>
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

        {/* Swipe-up-to-submit */}
        <View style={[s.track, { height: TRACK + 64, borderTopColor: colors.border }]}>
          <Animated.View style={[s.trackFill, { backgroundColor: modeColor, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.35] }) }]} />
          <Animated.Text style={[s.trackHint, { color: muted, opacity: progress.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }) }]}>
            Swipe up to {paperMode ? 'submit paper order' : 'submit LIVE order'}
          </Animated.Text>
          <Animated.View
            {...pan.panHandlers}
            style={[s.handle, { backgroundColor: modeColor, transform: [{ translateY: drag }] }]}
          >
            {isSubmitting
              ? <ActivityIndicator color="#fff" />
              : <Ionicons name="chevron-up" size={26} color="#fff" />}
          </Animated.View>
        </View>
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

function ExitLine({ label, value, color, colors, last }: { label: string; value: string; color: string; colors: any; last?: boolean }) {
  return (
    <View style={[s.exitLine, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text style={[s.exitLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[s.exitValue, { color }]}>{value}</Text>
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

  track:        { borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 26 },
  trackFill:    { ...StyleSheet.absoluteFillObject },
  trackHint:    { position: 'absolute', top: 22, fontSize: 13, fontWeight: '600' },
  handle:       { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
