import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerContractsModal } from '@/common/components/ticker/TickerContractsModal';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { useBriefEntryModes } from '@/hooks/queries/brief/useBriefEntryModes';
import { useSetBriefEntryMode } from '@/hooks/mutations/brief/useSetBriefEntryMode';
import { useSetupSessionBars } from '@/hooks/queries/ticker/useSetupSessionBars';
import { SetupChart, WhyThisSetup, ScoreExplainer, whyThisSetup } from './SetupChart';
import type {
  MuseBriefContent,
  MuseBriefTicker,
  MuseBriefEtf,
  MuseBriefSector,
} from '@/common/types/marketDigest';

// ---------------------------------------------------------------------------
// Trading-terminal digest view for muse-brief-v1 content.
// Single scrolling view: masthead → regime banner → tape → index regime →
// watchlist → Bandit's picks → footer. Entrance fanfare (staggered fade/slide,
// count-ups) plays on the 8:00 AM publish; the 9:00 AM silent
// refresh renders final values immediately (silent_update = true).
// ---------------------------------------------------------------------------

const MONO = 'monospace';

function scoreColor(score: number, colors: ReturnType<typeof useThemeColors>): string {
  if (score >= 80) return colors.success;
  if (score >= 65) return colors.warning;
  return colors.error;
}

/** JS count-up for score numbers (cheap, digest-grade — not 60fps-critical). */
function useCountUp(target: number, animate: boolean, duration = 1000): number {
  const [val, setVal] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate, duration]);
  return val;
}

function fmtScore(s: number): string {
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

/** Staggered entrance wrapper — skipped entirely on silent refreshes. */
function Enter({
  index,
  silent,
  children,
}: {
  index: number;
  silent: boolean;
  children: React.ReactNode;
}) {
  if (silent) return <>{children}</>;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 12) * 70).duration(450)}>
      {children}
    </Animated.View>
  );
}

// --- Ticker tape (ambient marquee) --------------------------------------------

export interface TapeItem {
  label: string;
  value: string;
  tone: 'up' | 'down' | 'flat';
}

function Tape({ items, colors }: { items: TapeItem[]; colors: ReturnType<typeof useThemeColors> }) {
  const translateX = useSharedValue(0);
  const [halfWidth, setHalfWidth] = useState(0);

  useEffect(() => {
    if (halfWidth <= 0) return;
    translateX.value = withRepeat(
      withTiming(-halfWidth, { duration: Math.max(8000, halfWidth * 28), easing: Easing.linear }),
      -1,
      false,
    );
  }, [halfWidth, translateX]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const toneColor = (t: TapeItem['tone']) =>
    t === 'up' ? colors.success : t === 'down' ? colors.error : colors.textTertiary;

  return (
    <View style={[styles.tape, { backgroundColor: colors.tape, borderColor: colors.border }]}>
      <Animated.View
        style={[{ flexDirection: 'row', alignItems: 'center' }, style]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width / 2;
          if (w > 0 && Math.abs(w - halfWidth) > 1) setHalfWidth(w);
        }}
      >
        {[...items, ...items].map((it, i) => (
          <Text key={i} style={[styles.tapeText, { color: colors.tapeText }]}>
            <Text style={{ color: colors.tapeMuted }}>{it.label} </Text>
            <Text style={{ color: toneColor(it.tone), fontWeight: '700' }}>{it.value}</Text>
            <Text style={{ color: colors.tapeMuted }}>   ///   </Text>
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

// --- Ticker card ---------------------------------------------------------------

function TickerCard({
  t,
  bandit,
  animate,
  colors,
  chartWidth,
  preview,
  entryMode,
  onSetEntryMode,
  onOpenChart,
}: {
  t: MuseBriefTicker;
  bandit: boolean;
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
  chartWidth: number;
  preview?: boolean;
  /** confirm/auto preference — watchlist cards only. */
  entryMode?: 'confirm' | 'auto';
  onSetEntryMode?: (mode: 'confirm' | 'auto') => void;
  onOpenChart?: () => void;
}) {
  const dirUp = t.direction === 'CALL';
  const dirColor = dirUp ? colors.success : colors.error;
  const [contractsVisible, setContractsVisible] = useState(false);
  const { data: sessionBars } = useSetupSessionBars(t.ticker);
  const iconBtn = {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surfaceSecondary,
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.mono, { fontSize: 17, fontWeight: '800', color: colors.text, letterSpacing: 0.5 }]}>
          {t.ticker}
        </Text>
        <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: dirColor }]}>{t.direction}</Text>
        </View>
        <View
          style={[styles.badge, { backgroundColor: colors.warning + '1F', borderColor: colors.warning + '66' }]}
          accessibilityLabel={`Breakout score ${fmtScore(t.score)}`}
        >
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: colors.warning }]}>
            {fmtScore(t.score)}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        {/* Contracts + chart — shown in preview too (the preview uses real
            tickers, so both work). */}
        <TouchableOpacity
          onPress={() => setContractsVisible(true)}
          style={iconBtn}
          accessibilityLabel={`${t.ticker} contracts`}
        >
          <Ionicons name="layers-outline" size={15} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenChart} style={iconBtn} accessibilityLabel={`${t.ticker} chart`}>
          <Ionicons name="stats-chart-outline" size={15} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>{t.premium_tier}</Text>
      </View>

      {/* entry mode: confirm first (default) or auto-enter — watchlist only */}
      {!bandit && !preview && entryMode && onSetEntryMode && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 }}>
          <Text style={[styles.mono, { fontSize: 9, letterSpacing: 1.5, color: colors.textTertiary }]}>
            ENTRY
          </Text>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
          >
            {(['confirm', 'auto'] as const).map((m) => {
              const active = entryMode === m;
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => onSetEntryMode(m)}
                  style={{
                    flex: 1,
                    paddingVertical: 7,
                    alignItems: 'center',
                    backgroundColor: active ? colors.text + '16' : 'transparent',
                  }}
                >
                  <Text
                    style={[
                      styles.mono,
                      {
                        fontSize: 10,
                        fontWeight: '800',
                        letterSpacing: 0.5,
                        color: active ? colors.text : colors.textTertiary,
                      },
                    ]}
                  >
                    {m === 'confirm' ? 'CONFIRM FIRST' : 'AUTO-ENTER'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      <TickerContractsModal
        ticker={t.ticker}
        visible={contractsVisible}
        onClose={() => setContractsVisible(false)}
      />

      {/* setup label (+ Bandit's thesis on picks) */}
      <View style={{ marginTop: 10, gap: 4 }}>
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.text }}>{t.setup}</Text>
        {bandit && t.thesis ? (
          <Text style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 17 }}>{t.thesis}</Text>
        ) : null}
      </View>

      <SetupChart t={t} width={chartWidth - 16} colors={colors} bars={sessionBars} />
      <WhyThisSetup text={whyThisSetup(t, sessionBars?.priorHigh, sessionBars?.priorLow)} colors={colors} />

      {/* if / then plan */}
      <View style={[styles.planBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Text style={[styles.mono, { fontSize: 10, fontWeight: '700', color: colors.success, marginBottom: 4 }]}>
          {'// IF → THEN'}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.text, lineHeight: 18 }}>{t.if_then}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' }}>
          <Ionicons name="shield-outline" size={13} color={colors.error} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.textSecondary, lineHeight: 16 }}>
            <Text style={{ fontWeight: '700', color: colors.error }}>Invalidation: </Text>
            {t.invalidation}
          </Text>
        </View>
      </View>

      <ScoreExplainer t={t} colors={colors} />
    </View>
  );
}

// --- ETF regime cards ----------------------------------------------------------

function EtfCard({
  etf,
  animate,
  colors,
}: {
  etf: MuseBriefEtf;
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const c = scoreColor(etf.score, colors);
  const arrow = etf.trend === 'up' ? '▲' : etf.trend === 'down' ? '▼' : '■';
  const arrowColor =
    etf.trend === 'up' ? colors.success : etf.trend === 'down' ? colors.error : colors.textTertiary;
  const display = useCountUp(etf.score, animate, 800);
  return (
    <View
      style={[
        styles.etfCard,
        { backgroundColor: colors.card, borderColor: colors.cardBorder, borderTopColor: c, borderTopWidth: 2 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: colors.text }]}>{etf.ticker}</Text>
        <Text style={{ fontSize: 10, color: arrowColor }}>{arrow}</Text>
      </View>
      <Text style={[styles.mono, { fontSize: 20, fontWeight: '800', color: c, marginTop: 2 }]}>
        {fmtScore(display)}
      </Text>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.textTertiary + '22', marginTop: 6, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${Math.min(100, etf.score)}%`, backgroundColor: c, borderRadius: 2 }} />
      </View>
      <Text style={[styles.mono, { fontSize: 9, color: colors.textTertiary, marginTop: 6 }]}>
        {etf.levels.support != null ? `S ${etf.levels.support.toFixed(0)}` : 'S —'}
        {'  ·  '}
        {etf.levels.resistance != null ? `R ${etf.levels.resistance.toFixed(0)}` : 'R —'}
      </Text>
      {etf.note ? (
        <Text style={{ fontSize: 10.5, color: colors.textSecondary, marginTop: 4, lineHeight: 14 }} numberOfLines={3}>
          {etf.note}
        </Text>
      ) : null}
    </View>
  );
}

function EtfRow({
  etfs,
  animate,
  colors,
}: {
  etfs: MuseBriefEtf[];
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (etfs.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {etfs.map((e) => (
        <EtfCard key={e.ticker} etf={e} animate={animate} colors={colors} />
      ))}
    </View>
  );
}

// --- Sector rotation: last-session % change per sector ETF -------------------

function SectorFlow({
  sectors,
  colors,
}: {
  sectors: MuseBriefSector[];
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (sectors.length === 0) return null;
  const max = Math.max(...sectors.map((s) => Math.abs(s.change_pct)), 0.5);
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        backgroundColor: colors.card,
        paddingHorizontal: 12,
        paddingVertical: 6,
      }}
    >
      {sectors.map((s) => {
        const up = s.change_pct >= 0;
        const c = up ? colors.success : colors.error;
        return (
          <View key={s.ticker} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 }}>
            {/* Symbol first (that's what trades), its sector underneath. */}
            <View style={{ width: 118 }}>
              <Text style={[styles.mono, { fontSize: 11, fontWeight: '800', color: colors.text }]}>{s.ticker}</Text>
              <Text style={[styles.mono, { fontSize: 9, color: colors.textTertiary }]} numberOfLines={1}>
                {s.name}
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                height: 5,
                borderRadius: 3,
                backgroundColor: colors.textTertiary + '1E',
                overflow: 'hidden',
                flexDirection: 'row',
                justifyContent: up ? 'flex-start' : 'flex-end',
              }}
            >
              <View
                style={{
                  height: '100%',
                  width: `${(Math.abs(s.change_pct) / max) * 100}%`,
                  backgroundColor: c,
                  borderRadius: 3,
                }}
              />
            </View>
            <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', color: c, width: 60, textAlign: 'right' }]}>
              {up ? '+' : ''}{s.change_pct.toFixed(2)}%
            </Text>
            <Text style={[styles.mono, { fontSize: 9, color: colors.textTertiary, width: 56, textAlign: 'right' }]}>
              5d {s.change_5d_pct >= 0 ? '+' : ''}{s.change_5d_pct.toFixed(1)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function SectionHeader({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

// --- Overnight tape (news) -----------------------------------------------------

function NewsSection({
  news,
  colors,
}: {
  news: NonNullable<MuseBriefContent['news']>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (news.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {news.map((n, i) => (
        <View
          key={i}
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            backgroundColor: colors.card,
            padding: 10,
            borderLeftWidth: 2,
            borderLeftColor: colors.warning,
          }}
        >
          <Text style={{ fontSize: 12.5, color: colors.text, lineHeight: 17, fontWeight: '600' }}>
            {n.headline}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 }}>
            <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>{n.source}</Text>
            {n.tickers.slice(0, 3).map((t) => (
              <Text
                key={t}
                style={[
                  styles.mono,
                  { fontSize: 9, color: colors.textSecondary, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
                ]}
              >
                {t}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// --- Today's catalysts (economic + earnings calendar) ---------------------------

function EventsSection({
  events,
  colors,
}: {
  events: NonNullable<MuseBriefContent['events']>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (events.length === 0) return null;
  const impactColor = (impact: string) =>
    impact === 'high' ? colors.error : impact === 'medium' ? colors.warning : colors.textTertiary;
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        backgroundColor: colors.card,
        padding: 12,
      }}
    >
      {events.map((e, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, paddingVertical: 7 }}>
          <Text style={[styles.mono, { width: 64, fontSize: 10.5, color: colors.textSecondary, paddingTop: 1 }]}>
            {e.time_et}
          </Text>
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: impactColor(e.impact),
              marginTop: 4,
            }}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12.5, color: colors.text, fontWeight: '600' }}>{e.label}</Text>
            {(e.consensus || e.prior) && (
              <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, marginTop: 2 }]}>
                {e.consensus ? `cons ${e.consensus}` : ''}
                {e.consensus && e.prior ? '   ·   ' : ''}
                {e.prior ? `prior ${e.prior}` : ''}
              </Text>
            )}
          </View>
          <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: impactColor(e.impact), paddingTop: 2 }]}>
            {e.impact.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --- What to watch ---------------------------------------------------------------

function WatchSection({
  watch,
  colors,
}: {
  watch: NonNullable<MuseBriefContent['watch']>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (watch.length === 0) return null;
  return (
    <View style={{ gap: 7 }}>
      {watch.map((w, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Text style={[styles.mono, { fontSize: 11, color: colors.success, paddingTop: 1 }]}>{'>'}</Text>
          <Text style={{ flex: 1, fontSize: 12.5, color: colors.textSecondary, lineHeight: 18 }}>{w}</Text>
        </View>
      ))}
    </View>
  );
}

// --- Main view -------------------------------------------------------------------

export function MuseDigestView({
  content,
  dateLabel,
  preview = false,
  onCloseDigest,
}: {
  content: MuseBriefContent;
  dateLabel: string;
  /** In-app preview of the layout with sample data — badges the masthead. */
  preview?: boolean;
  /** Dismiss the digest (the chart icon closes it, then opens the ticker chart). */
  onCloseDigest?: () => void;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const layout = useWindowDimensions();
  const chartWidth = Math.max(200, layout.width - 56); // screen padding + card padding
  const silent = content.silent_update === true;
  const animate = !silent;
  const { toTicker } = useBaseNavigation();

  // Per-ticker entry preferences (confirm = ask first, auto = enter on
  // trigger). Missing tickers default to confirm — same as the 9:00 ET build.
  const { data: entryModes } = useBriefEntryModes();
  const setEntryMode = useSetBriefEntryMode();

  const openTickerChart = (ticker: string) => {
    // The digest is a native full-screen modal; the ticker sheet would open
    // behind it, so dismiss first, then navigate once it's gone.
    onCloseDigest?.();
    setTimeout(() => toTicker(ticker, { fullScreenChart: true }), 350);
  };

  const regimeColor =
    content.market.regime === 'risk-on'
      ? colors.success
      : content.market.regime === 'risk-off'
        ? colors.error
        : colors.warning;

  const tapeItems: TapeItem[] = [
    ...Object.entries(content.market.futures).map(([k, v]) => ({
      label: k.toUpperCase(),
      value: v,
      tone: (v.trim().startsWith('-') ? 'down' : v.trim().startsWith('+') ? 'up' : 'flat') as TapeItem['tone'],
    })),
    ...(content.market.vix != null ? [{ label: 'VIX', value: String(content.market.vix), tone: 'flat' as const }] : []),
    ...content.etfs.map((e) => ({
      label: e.ticker,
      value: fmtScore(e.score),
      tone: (e.trend === 'up' ? 'up' : e.trend === 'down' ? 'down' : 'flat') as TapeItem['tone'],
    })),
  ];

  let genTime = '';
  try {
    genTime = format(parseISO(content.generated_at), 'h:mm a');
  } catch {
    genTime = '';
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: insets.bottom + 28 }}
      showsVerticalScrollIndicator={false}
    >
      {/* masthead */}
      <Enter index={0} silent={silent}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 2 }}>
          <View style={{ flex: 1 }} />
          {preview ? (
            <View style={[styles.badge, { backgroundColor: colors.warning + '1E', borderColor: colors.warning + '55' }]}>
              <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: colors.warning }]}>
                PREVIEW DATA
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.badge,
              preview ? { marginLeft: 6 } : null,
              {
                backgroundColor: silent ? colors.warning + '1E' : colors.success + '1E',
                borderColor: silent ? colors.warning + '55' : colors.success + '55',
              },
            ]}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: silent ? colors.warning : colors.success,
              }}
            />
            <Text
              style={[
                styles.mono,
                { fontSize: 10, fontWeight: '800', color: silent ? colors.warning : colors.success },
              ]}
            >
              {silent ? 'REFRESH' : 'LIVE'}
            </Text>
          </View>
        </View>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: 0.5 }}>
          Morning Brief
        </Text>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary, marginTop: 2 }]}>
          {dateLabel}{genTime ? `  ·  generated ${genTime} ET` : ''}
        </Text>
      </Enter>

      {/* regime banner */}
      <Enter index={1} silent={silent}>
        <View
          style={[
            styles.regime,
            { backgroundColor: colors.card, borderColor: colors.cardBorder, borderLeftColor: regimeColor },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
            MARKET REGIME
          </Text>
          <Text style={[styles.mono, { fontSize: 20, fontWeight: '800', color: regimeColor, marginTop: 2 }]}>
            {content.market.regime.toUpperCase().replace('-', ' ')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 6, lineHeight: 18 }}>
            {content.market.headline}
          </Text>
        </View>
      </Enter>

      {/* tape */}
      <Enter index={2} silent={silent}>
        <View style={{ marginTop: 12 }}>
          <Tape items={tapeItems} colors={colors} />
        </View>
      </Enter>

      {/* index regime */}
      <Enter index={3} silent={silent}>
        <SectionHeader label="INDEX REGIME" colors={colors} />
        <EtfRow etfs={content.etfs} animate={animate} colors={colors} />
      </Enter>

      {/* sector flow — where the market is positioning */}
      {(content.sectors?.length ?? 0) > 0 && (
        <Enter index={3.5} silent={silent}>
          <SectionHeader label="SECTOR FLOW" colors={colors} />
          <SectorFlow sectors={content.sectors ?? []} colors={colors} />
        </Enter>
      )}

      {/* overnight tape */}
      {(content.news?.length ?? 0) > 0 && (
        <Enter index={4} silent={silent}>
          <SectionHeader label="OVERNIGHT TAPE" colors={colors} />
          <NewsSection news={content.news ?? []} colors={colors} />
        </Enter>
      )}

      {/* today's catalysts */}
      {(content.events?.length ?? 0) > 0 && (
        <Enter index={5} silent={silent}>
          <SectionHeader label="TODAY'S CATALYSTS" colors={colors} />
          <EventsSection events={content.events ?? []} colors={colors} />
        </Enter>
      )}

      {/* what to watch */}
      {(content.watch?.length ?? 0) > 0 && (
        <Enter index={6} silent={silent}>
          <SectionHeader label="WHAT TO WATCH" colors={colors} />
          <WatchSection watch={content.watch ?? []} colors={colors} />
        </Enter>
      )}

      {/* watchlist */}
      <Enter index={7} silent={silent}>
        <SectionHeader label="WATCHLIST · TINDEX" colors={colors} />
      </Enter>
      {content.watchlist.map((t, i) => (
        <Enter key={t.ticker} index={8 + i} silent={silent}>
          <TickerCard
            t={t}
            bandit={false}
            animate={animate}
            colors={colors}
            chartWidth={chartWidth}
            preview={preview}
            entryMode={entryModes?.[t.ticker] ?? 'confirm'}
            onSetEntryMode={(mode) => setEntryMode.mutate({ ticker: t.ticker, mode })}
            onOpenChart={() => openTickerChart(t.ticker)}
          />
        </Enter>
      ))}

      {/* bandit's picks */}
      <Enter index={12} silent={silent}>
        <SectionHeader label="BANDIT'S PICKS" colors={colors} />
      </Enter>
      {content.muse_picks.map((t, i) => (
        <Enter key={t.ticker} index={13 + i} silent={silent}>
          <TickerCard
            t={t}
            bandit
            animate={animate}
            colors={colors}
            chartWidth={chartWidth}
            preview={preview}
            onOpenChart={() => openTickerChart(t.ticker)}
          />
        </Enter>
      ))}

      {/* footer */}
      <Enter index={17} silent={silent}>
        <View style={{ marginTop: 22 }}>
          {content.correlation_note ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name="link-outline" size={14} color={colors.warning} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 }}>
                {content.correlation_note}
              </Text>
            </View>
          ) : null}
          {content.earnings_blackout.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, alignSelf: 'center' }]}>
                EARNINGS BLACKOUT:
              </Text>
              {content.earnings_blackout.map((t) => (
                <View
                  key={t}
                  style={[styles.badge, { backgroundColor: colors.error + '18', borderColor: colors.error + '44' }]}
                >
                  <Text style={[styles.mono, { fontSize: 10, fontWeight: '700', color: colors.error }]}>{t}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={[styles.mono, { fontSize: 9, color: colors.textTertiary, marginTop: 14, textAlign: 'center' }]}>
            {'— end of brief · plan, not prediction —'}
          </Text>
        </View>
      </Enter>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: MONO },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  regime: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 14,
    overflow: 'hidden',
  },
  tape: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  tapeText: { fontFamily: MONO, fontSize: 11 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  etfCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  planBox: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
});
