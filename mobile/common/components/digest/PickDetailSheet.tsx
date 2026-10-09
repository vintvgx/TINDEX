import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useSetupSessionBars, SETUP_BARS_INTERVAL, type SetupSessionBars } from '@/hooks/queries/ticker/useSetupSessionBars';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { useEntryCheck, type EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { useMorningBrief } from '@/hooks/queries/brief/useMorningBrief';
import { useCreateKeyLevel } from '@/hooks/mutations/priceLevels/useCreateKeyLevel';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useToast } from '@/common/components/ui/Toast';
import { TickerContractsModal } from '@/common/components/ticker/TickerContractsModal';
import { SetupChart, setupLevels, topDrivers, triggerDistancePct, whyThisSetup } from './SetupChart';
import { pickContractRows, type PickContractRow } from './pickContracts';
import type { MuseBriefTicker } from '@/common/types/marketDigest';

type Colors = ReturnType<typeof useThemeColors>;

const SCREEN_H = Dimensions.get('window').height;
const SCREEN_W = Dimensions.get('window').width;
const SHEET_H = SCREEN_H * 0.92;
const PAD_X = 18;
// Look for the setup's expiration this far out — the same window the digest's
// premium-tier estimate uses (muse.py _estimate_premium_tier).
const EXPIRY_WINDOW_DAYS = 14;
// Swipe-down distance / velocity that dismisses instead of springing back.
const DISMISS_DY = 120;
const DISMISS_VY = 1;

function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** "10:52 AM" from an ET "HH:MM". */
function fmtHhmm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtEtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

const fmtStrike = (k: number) => (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1));

/**
 * When the trigger broke: the brief's own record (the play's `checking`
 * event, logged on the 1-min close through it) when this ticker is a brief
 * play, else the first regular-session bar that closed through it — bar
 * resolution, so marked approximate.
 */
function useBreakTime(t: MuseBriefTicker, bars: SetupSessionBars | undefined): string | null {
  const { data: brief } = useMorningBrief();
  return useMemo(() => {
    const play = brief?.plays.find((p) => p.ticker === t.ticker);
    const hit = play?.history.find((h) => h.event === 'checking');
    if (hit) return fmtEtTime(hit.at);
    const { long, trigger } = setupLevels(t);
    if (trigger == null) return null;
    const bar = bars?.today.find(
      (b) => b.hhmm != null && b.hhmm >= '09:30' && (long ? b.c > trigger : b.c < trigger),
    );
    return bar?.hhmm ? `~${fmtHhmm(bar.hhmm)}` : null;
  }, [brief, bars, t]);
}

/** Nearest expiration in the window, then that expiration's chain for the play's side. */
function usePickContracts(t: MuseBriefTicker) {
  const today = etToday();
  const { data: expData, isLoading: expLoading } = useOptionsQuery(t.ticker, {
    limit: 1,
    expiration_date_gte: today,
    expiration_date_lte: addDays(today, EXPIRY_WINDOW_DAYS),
  });
  const expiration = useMemo(() => {
    const exps = expData?.success ? [...expData.data.expirations_fetched].sort() : [];
    return exps[0] ?? null;
  }, [expData]);
  const { data: chainData, isLoading: chainLoading } = useOptionsQuery(
    expiration ? t.ticker : '',
    expiration ? { limit: 40, expiration_date_gte: expiration, expiration_date_lte: expiration } : undefined,
    15_000,
  );
  const rows = useMemo(() => {
    if (!chainData?.success) return [];
    const side = t.direction === 'CALL' ? chainData.data.calls : chainData.data.puts;
    const { long, trigger, target } = setupLevels(t);
    return pickContractRows(side, long, trigger, target);
  }, [chainData, t]);
  return {
    expiration,
    dte: expiration ? daysBetween(today, expiration) : null,
    rows,
    loading: expLoading || (!!expiration && chainLoading),
  };
}

type Tone = 'neg' | 'pos' | 'warn' | 'neutral';

function signalChips(check: EntryCheck | undefined): { label: string; tone: Tone }[] {
  if (!check) return [];
  const { trend, rsi, vwap, orb } = check.rows;
  const chips: { label: string; tone: Tone }[] = [];
  if (trend) {
    chips.push({ label: `Trend ${trend.label}`, tone: trend.label === 'Bearish' ? 'neg' : trend.label === 'Bullish' ? 'pos' : 'warn' });
  }
  if (rsi) {
    const v = Math.round(rsi.value);
    chips.push({ label: `RSI ${v}`, tone: v < 45 ? 'neg' : v > 55 ? 'pos' : 'neutral' });
  }
  if (vwap) chips.push({ label: `VWAP ${vwap.position}`, tone: vwap.position === 'Below' ? 'neg' : 'pos' });
  if (orb) {
    chips.push({
      label: `ORB ${orb.position}`,
      tone: orb.position === 'Below low' ? 'neg' : orb.position === 'Above high' ? 'pos' : orb.position === 'Inside' ? 'warn' : 'neutral',
    });
  }
  return chips;
}

/**
 * Pick Detail Sheet — tapping a Muse Pick / TINDEX top play in the Home
 * morning-brief digest opens this for that one setup (the full brief stays
 * on "Open full" / background taps). Bottom sheet in the app's hand-rolled
 * Modal + Animated pattern (see TickerSheetProvider), plus swipe-down.
 */
export function PickDetailSheet({ pick, onClose }: { pick: MuseBriefTicker | null; onClose: () => void }) {
  const colors = useThemeColors();
  const slide = useRef(new Animated.Value(SHEET_H)).current;
  // Keep the last pick rendered through the close animation.
  const [shown, setShown] = useState<MuseBriefTicker | null>(pick);

  useEffect(() => {
    if (pick) {
      setShown(pick);
      slide.setValue(SHEET_H);
      Animated.spring(slide, { toValue: 0, damping: 30, stiffness: 240, useNativeDriver: true }).start();
    }
  }, [pick, slide]);

  const close = () => {
    Animated.timing(slide, { toValue: SHEET_H, duration: 220, useNativeDriver: true }).start(() => {
      setShown(null);
      onClose();
    });
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Swipe-down on the grabber/header.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => slide.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > DISMISS_DY || g.vy > DISMISS_VY) closeRef.current();
          else Animated.spring(slide, { toValue: 0, damping: 30, stiffness: 240, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(slide, { toValue: 0, damping: 30, stiffness: 240, useNativeDriver: true }).start(),
      }),
    [slide],
  );

  return (
    <Modal transparent animationType="none" visible={shown != null} onRequestClose={close} statusBarTranslucent>
      <SafeAreaProvider>
        <Pressable style={styles.backdrop} onPress={close} />
        <Animated.View
          style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border, transform: [{ translateY: slide }] }]}
        >
          <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
            {shown && <SheetBody t={shown} colors={colors} onClose={close} panHandlers={pan.panHandlers} />}
          </SafeAreaView>
        </Animated.View>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetBody({
  t,
  colors,
  onClose,
  panHandlers,
}: {
  t: MuseBriefTicker;
  colors: Colors;
  onClose: () => void;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
}) {
  const toast = useToast();
  const { authState: { user } } = useAuth();
  const { long, trigger, invalidation, target } = setupLevels(t);
  const dirColor = long ? colors.success : colors.error;

  // Live price off the shared app-wide /ws/prices socket — the digest is
  // already streaming this ticker, so this adds no connection.
  const { livePrices } = useMarketStream([t.ticker]);
  const { data: bars } = useSetupSessionBars(t.ticker);
  const lastBar = bars?.today.at(-1)?.c ?? bars?.yesterday.at(-1)?.c ?? null;
  const price = livePrices[t.ticker] ?? lastBar;

  const dist = triggerDistancePct(t, price);
  const through = dist != null && dist <= 0;
  const breakTime = useBreakTime(t, bars);

  // Approach meter: how much of the gap from yesterday's close to the
  // trigger has been covered.
  const meter = useMemo(() => {
    if (dist == null || through || trigger == null || price == null) return 0;
    const ref = bars?.yesterday.at(-1)?.c;
    const refGap = ref != null ? (long ? trigger - ref : ref - trigger) : null;
    const gap = long ? trigger - price : price - trigger;
    if (refGap != null && refGap > gap) return Math.min(1, Math.max(0, 1 - gap / refGap));
    return Math.min(1, Math.max(0, 1 - dist / 3));
  }, [dist, through, trigger, price, bars, long]);

  const { data: check } = useEntryCheck(t.ticker, t.direction);
  const chips = signalChips(check);
  const contracts = usePickContracts(t);
  const systemPick = contracts.rows.find((r) => r.systemPick) ?? null;

  const rr =
    trigger != null && target != null && invalidation != null && trigger !== invalidation
      ? Math.abs(target - trigger) / Math.abs(trigger - invalidation)
      : null;
  const why = t.thesis ?? whyThisSetup(t, bars?.priorHigh, bars?.priorLow);
  const scoring = topDrivers(t);

  const { mutate: createLevel, isPending: arming } = useCreateKeyLevel();
  const [armed, setArmed] = useState(false);
  const armAlert = () => {
    if (!user?.id || trigger == null) return;
    createLevel(
      {
        userId: user.id,
        ticker: t.ticker,
        direction: long ? 'bullish' : 'bearish',
        levelLow: trigger,
        zoneType: 'trade',
        notes: `Brief pick — ${t.setup} ${t.direction} trigger${target != null ? `, target ${target.toFixed(2)}` : ''}`,
      },
      {
        onSuccess: () => {
          setArmed(true);
          toast.success(`Alert armed: ${t.ticker} 1-min close ${long ? 'above' : 'below'} ${trigger.toFixed(2)}`);
        },
        onError: (e) => toast.error(e.message || 'Failed to set alert'),
      },
    );
  };

  const [chain, setChain] = useState<{ initial?: PickContractRow } | null>(null);

  const chartW = SCREEN_W - PAD_X * 2 - 2;
  const tone = (k: Tone) =>
    k === 'neg' ? colors.error : k === 'pos' ? colors.success : k === 'warn' ? colors.warning : colors.textSecondary;
  const heroColor = through ? colors.error : colors.warning;
  const pickLabel = systemPick ? `$${fmtStrike(systemPick.contract.strike)}${long ? 'C' : 'P'}` : null;

  return (
    <>
      <View {...panHandlers}>
        <View style={[styles.grabber, { backgroundColor: colors.textTertiary }]} />
        {/* 4a header */}
        <View style={[styles.row, { paddingHorizontal: PAD_X, paddingTop: 6, paddingBottom: 4, gap: 8 }]}>
          <Text style={[styles.ticker, { color: colors.text }]}>{t.ticker}</Text>
          <Badge label={t.direction} color={dirColor} />
          <Badge label={Number.isInteger(t.score) ? String(t.score) : t.score.toFixed(1)} color={colors.warning} />
          <Text style={{ flexShrink: 1, fontSize: 13, color: colors.textSecondary }} numberOfLines={1}>{t.setup}</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onClose} hitSlop={10} style={[styles.close, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: PAD_X, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
        // Pulling down past the top dismisses, like the grabber swipe.
        onScrollEndDrag={(e) => {
          if (e.nativeEvent.contentOffset.y < -80) onClose();
        }}
      >
        {/* 4b trigger-status hero */}
        <View style={[styles.hero, { backgroundColor: heroColor + '18', borderColor: heroColor + '55' }]}>
          <Text style={[styles.heroLabel, { color: colors.textTertiary }]}>TRIGGER STATUS</Text>
          {dist == null ? (
            <Text style={[styles.heroBig, { color: colors.textTertiary }]}>—</Text>
          ) : through ? (
            <>
              <Text style={[styles.heroBig, { color: colors.error }]}>THROUGH TRIGGER</Text>
              <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
                {breakTime ? `Broke ${trigger!.toFixed(2)} at ${breakTime}` : `Through ${trigger!.toFixed(2)}`}
                {` · now ${Math.abs(dist).toFixed(2)}% ${long ? 'above' : 'below'}`}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.heroBig, { color: colors.warning }]}>{dist.toFixed(2)}% TO TRIGGER</Text>
              <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
                ${Math.abs(trigger! - price!).toFixed(2)} away · alert will fire on a 1-min close through {trigger!.toFixed(2)}
              </Text>
              <View style={[styles.meter, { backgroundColor: colors.border }]}>
                <View style={{ width: `${meter * 100}%`, height: '100%', borderRadius: 4, backgroundColor: colors.warning }} />
              </View>
            </>
          )}
        </View>

        {/* 4c price row */}
        <View style={[styles.row, { justifyContent: 'space-between', marginTop: 12, marginHorizontal: 2 }]}>
          <PriceCell label="LIVE" value={price} color={colors.text} colors={colors} />
          <PriceCell label="TRIGGER" value={trigger} color={colors.warning} colors={colors} align="center" />
          <PriceCell label="STOP" value={invalidation} color={colors.error} colors={colors} align="flex-end" />
        </View>

        {/* 4d setup chart */}
        <View style={[styles.chartWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <SetupChart t={t} width={chartW} colors={colors} bars={bars} livePrice={price} variant="sheet" />
          <Text style={[styles.chartTag, { color: colors.textTertiary, backgroundColor: colors.background + 'CC' }]}>
            YESTERDAY · TODAY {SETUP_BARS_INTERVAL.toUpperCase()}
          </Text>
        </View>

        {/* 4e signals */}
        <Text style={[styles.secTitle, { color: colors.textTertiary }]}>SIGNALS</Text>
        {chips.length ? (
          <View style={styles.chips}>
            {chips.map((c) => {
              const col = tone(c.tone);
              const tinted = c.tone !== 'neutral';
              return (
                <View
                  key={c.label}
                  style={[
                    styles.chip,
                    tinted
                      ? { backgroundColor: col + '14', borderColor: col + '55' }
                      : { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  ]}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: col }}>{c.label}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>Loading technicals…</Text>
        )}

        {/* 4f potential contracts */}
        <Text style={[styles.secTitle, { color: colors.textTertiary }]}>
          POTENTIAL CONTRACTS{contracts.dte != null ? ` · ${contracts.dte} DTE` : ''}
        </Text>
        {contracts.loading ? (
          <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: 12 }} />
        ) : contracts.rows.length === 0 ? (
          <Text style={{ fontSize: 12, color: colors.textTertiary, marginBottom: 8 }}>
            No contracts at or above the $0.35 premium floor for this expiration.
          </Text>
        ) : (
          contracts.rows.map((r) => (
            <View
              key={r.contract.symbol}
              style={[
                styles.contract,
                r.systemPick
                  ? { borderColor: colors.success + '66', backgroundColor: colors.success + '0D' }
                  : { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <View>
                <Text style={[styles.strike, { color: colors.text }]}>
                  ${fmtStrike(r.contract.strike)}{long ? 'C' : 'P'}
                </Text>
                <Text style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
                  {format(parseISO(r.contract.expiration), 'MMM d')} · {contracts.dte} DTE
                </Text>
              </View>
              {r.systemPick && (
                <View style={[styles.pickTag, { borderColor: colors.success + '55' }]}>
                  <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 1, color: colors.success }}>SYSTEM PICK</Text>
                </View>
              )}
              <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
                <Text style={[styles.mid, { color: r.systemPick ? colors.success : colors.text }]}>${r.mid.toFixed(2)}</Text>
                <Text style={[styles.tabular, { fontSize: 11, color: colors.textTertiary, marginTop: 2 }]}>
                  {r.contract.bid.toFixed(2)} × {r.contract.ask.toFixed(2)}
                </Text>
              </View>
            </View>
          ))
        )}
        <TouchableOpacity
          onPress={() => setChain({})}
          activeOpacity={0.7}
          style={[styles.viewAll, { borderColor: colors.border }]}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.textSecondary }}>View all contracts →</Text>
        </TouchableOpacity>

        {/* 4g setup detail */}
        <Text style={[styles.secTitle, { color: colors.textTertiary }]}>SETUP DETAIL</Text>
        <View style={[styles.meta, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MetaRow k="Trigger → target" colors={colors}
            v={trigger != null && target != null ? `${trigger.toFixed(2)} → ${target.toFixed(2)}` : '—'} />
          <MetaRow k="Reward / risk" colors={colors} v={rr != null ? `${rr.toFixed(1)}R` : '—'} color={rr != null ? colors.success : undefined} />
          <MetaRow k="Invalidation" colors={colors}
            v={t.invalidation || (invalidation != null ? `stop ${invalidation.toFixed(2)}` : '—')} />
          {scoring && <MetaRow k="Scoring" colors={colors} v={scoring} />}
          {why ? (
            <Text style={[styles.why, { color: colors.textSecondary, borderTopColor: colors.border }]}>{why}</Text>
          ) : null}
        </View>

        {/* 4h CTAs */}
        <View style={[styles.row, { gap: 10, marginTop: 18 }]}>
          <TouchableOpacity
            onPress={armAlert}
            disabled={armed || arming || trigger == null}
            activeOpacity={0.7}
            style={[styles.btn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 }]}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>
              {armed ? 'Alert armed ✓' : arming ? 'Arming…' : 'Set trigger alert'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setChain(systemPick ? { initial: systemPick } : {})}
            activeOpacity={0.8}
            style={[styles.btn, { backgroundColor: colors.success }]}
          >
            <Text style={[styles.btnText, { color: '#06240f' }]}>{pickLabel ? `Review ${pickLabel}` : 'Review contracts'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Full chain — "View all", or "Review" opened onto the system pick's
          detail/Review step (the existing confirm-first entry). */}
      <TickerContractsModal
        ticker={t.ticker}
        visible={chain != null}
        onClose={() => setChain(null)}
        initialContract={
          chain?.initial
            ? { symbol: chain.initial.contract.symbol, side: t.direction, expiration: chain.initial.contract.expiration }
            : undefined
        }
      />
    </>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color + '66', backgroundColor: color + '1A' }]}>
      <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color }}>{label}</Text>
    </View>
  );
}

function PriceCell({
  label, value, color, colors, align = 'flex-start',
}: { label: string; value: number | null | undefined; color: string; colors: Colors; align?: 'flex-start' | 'center' | 'flex-end' }) {
  return (
    <View style={{ alignItems: align }}>
      <Text style={{ fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary, marginBottom: 3 }}>{label}</Text>
      <Text style={[styles.tabular, { fontSize: 19, fontWeight: '800', color }]}>{value != null ? value.toFixed(2) : '—'}</Text>
    </View>
  );
}

function MetaRow({ k, v, colors, color }: { k: string; v: string; colors: Colors; color?: string }) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 5, gap: 12 }]}>
      <Text style={{ fontSize: 13, color: colors.textTertiary }}>{k}</Text>
      <Text style={[styles.tabular, { flexShrink: 1, textAlign: 'right', fontSize: 13, fontWeight: '700', color: color ?? colors.text }]}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SHEET_H,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grabber: { width: 40, height: 5, borderRadius: 3, opacity: 0.5, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  ticker: { fontSize: 24, fontWeight: '800', letterSpacing: 0.5 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7, borderWidth: 1 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  hero: { marginTop: 12, marginBottom: 4, padding: 16, borderRadius: 16, borderWidth: 1, alignItems: 'center' },
  heroLabel: { fontSize: 11, letterSpacing: 2.5, marginBottom: 6 },
  heroBig: { fontSize: 30, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center' },
  heroSub: { fontSize: 13, marginTop: 6, textAlign: 'center' },
  meter: { alignSelf: 'stretch', height: 8, borderRadius: 4, marginTop: 12, overflow: 'hidden' },
  chartWrap: { marginTop: 10, marginBottom: 4, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  chartTag: {
    position: 'absolute', top: 8, left: 10, fontSize: 10, letterSpacing: 1.5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden',
  },
  secTitle: { fontSize: 11, letterSpacing: 2.5, marginTop: 18, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  contract: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8,
  },
  strike: { fontSize: 16, fontWeight: '800' },
  pickTag: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  mid: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tabular: { fontVariant: ['tabular-nums'] },
  viewAll: { alignItems: 'center', padding: 13, marginTop: 4, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed' },
  meta: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
  why: { fontSize: 13, lineHeight: 20, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 15, borderRadius: 15 },
  btnText: { fontSize: 15, fontWeight: '800' },
});
