import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { useUnfollowTickerORB } from '@/hooks/mutations/orb/useSetORBMonitoringActiveMutation';
import { useIsFollowingORB, useUpdateORBNotificationTypes } from '@/hooks/mutations/ticker/tickerORB';
import { AnimatedNumber } from './AnimatedNumber';
import { GapTrendBadges } from './GapTrendBadges';
import type { GapTrendContext } from '@/common/types/orb';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useTickerTechnicals } from '@/hooks/queries/technicals/useTickerTechnicals';
import { EMAZoneBadge } from '@/common/components/shared/EMAZoneBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ORBDetailModalProps {
  visible: boolean;
  data: ORBMonitoringState | null;
  onClose: () => void;
  onNavigateToTicker?: (ticker: string) => void;
  gapTrendContext?: GapTrendContext | null;
}

type Tab = 'Overview' | 'Levels' | 'Details';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIB_MULTIPLIERS = [1.0, 1.618, 2.0] as const;
const FIB_COLORS: [string, string, string] = ['#B45309', '#D97706', '#FCD34D'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fp = (v: number | null | undefined) =>
  v == null || isNaN(v) ? 'N/A' : `$${v.toFixed(2)}`;

const fv = (v: number | null | undefined): string => {
  if (v == null || isNaN(v)) return 'N/A';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
};

const fd = (s: string | undefined): string => {
  if (!s) return 'N/A';
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
};

const ft = (s: string | undefined): string => {
  if (!s) return 'N/A';
  try {
    return new Date(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  } catch { return 'N/A'; }
};

const getFibLevels = (orbHigh: number, orbLow: number) => {
  const range = orbHigh - orbLow;
  if (range <= 0) return { above: [], below: [] };
  return {
    above: FIB_MULTIPLIERS.map((m, i) => ({ label: `${m}×`, price: orbHigh + range * m, multiplier: m, color: FIB_COLORS[i] })),
    below: FIB_MULTIPLIERS.map((m, i) => ({ label: `${m}×`, price: orbLow - range * m, multiplier: m, color: FIB_COLORS[i] })),
  };
};

const getBreakoutColor = (type: string, colors: ReturnType<typeof useThemeColors>) => {
  if (type.startsWith('Retesting')) return '#F59E0B';
  if (type.includes('Bullish')) return colors.success;
  if (type.includes('Bearish')) return colors.error;
  if (type === 'invalidated') return colors.textTertiary;
  if (type === 'reversal') return '#8B5CF6';
  return colors.textTertiary;
};

const getBreakoutLabel = (type: string): string => {
  switch (type) {
    case 'Bullish': return 'Bullish Breakout';
    case 'Confirmed Bullish': return 'Confirmed Bullish ✓';
    case 'Bearish': return 'Bearish Breakdown';
    case 'Confirmed Bearish': return 'Confirmed Bearish ✓';
    case 'Retesting Bullish': return 'Retesting High (Bullish)';
    case 'Retesting Bearish': return 'Retesting Low (Bearish)';
    case 'invalidated': return 'Breakout Exhausted';
    case 'reversal': return 'Reversal Detected';
    default: return 'No Breakout';
  }
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const Divider = ({ colors }: { colors: ReturnType<typeof useThemeColors> }) => (
  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: 12 }} />
);

const Row = ({
  label, value, valueColor, colors,
}: {
  label: string; value: string; valueColor?: string; colors: ReturnType<typeof useThemeColors>;
}) => (
  <View style={styles.row}>
    <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{label}</Text>
    <Text style={[styles.rowValue, { color: valueColor ?? colors.text }]}>{value}</Text>
  </View>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const ORBDetailModal: React.FC<ORBDetailModalProps> = ({
  visible, data, onClose, onNavigateToTicker, gapTrendContext,
}) => {
  const colors = useThemeColors();
  const setMonitoringActive = useUnfollowTickerORB();
  const { authState: { user } } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const { data: tech } = useTickerTechnicals(data?.ticker ?? null);
  const { data: followState } = useIsFollowingORB(data?.ticker ?? '');
  const updateNotificationTypes = useUpdateORBNotificationTypes(data?.ticker ?? '');

  const handleUnfollow = () => {
    if (!data?.ticker) return;
    setMonitoringActive.mutate(
      { user, ticker: data.ticker, monitoring_active: false },
      { onSuccess: onClose },
    );
  };

  if (!data) return null;

  // ── Computed values ────────────────────────────────────────────────────────
  const orbHigh = data.orb_high ?? 0;
  const orbLow = data.orb_low ?? 0;
  const currentPrice = data.current_price ?? 0;
  const orbRange = orbHigh - orbLow;
  const isAboveHigh = currentPrice > orbHigh;
  const isBelowLow = currentPrice < orbLow;
  const isInRange = !isAboveHigh && !isBelowLow && orbRange > 0;

  // Visual range bounds
  let visualMin = orbLow;
  let visualMax = orbHigh;
  if (orbRange > 0) {
    if (isAboveHigh) visualMax = Math.max(orbHigh + orbRange * 2, currentPrice + orbRange * 0.1);
    else if (isBelowLow) visualMin = Math.min(orbLow - orbRange * 2, currentPrice - orbRange * 0.1);
  }
  const visualRange = visualMax - visualMin;
  const pct = (price: number) =>
    visualRange > 0 ? Math.max(0, Math.min(100, ((price - visualMin) / visualRange) * 100)) : 50;

  const fibLevels = orbRange > 0 ? getFibLevels(orbHigh, orbLow) : { above: [], below: [] };
  const priceColor = isAboveHigh ? colors.success : isBelowLow ? colors.error : colors.text;
  const bkColor = getBreakoutColor(data.breakout_type, colors);
  const hasBreakout = data.breakout_type !== 'none';

  // Notification-type toggles default to on (matches the DB column defaults)
  // until the follow row loads.
  const notifyConfirmed = followState?.notify_confirmed_breakout ?? true;
  const notifyReversal = followState?.notify_reversal ?? true;
  const notifAllOn = notifyConfirmed && notifyReversal;

  // Position label
  const distFromORH = isAboveHigh ? currentPrice - orbHigh : null;
  const distFromORL = isBelowLow ? orbLow - currentPrice : null;

  // Percentage change
  const pctChange = data.percentage_change
    ?? (data.opening_price && data.opening_price > 0
      ? ((currentPrice - data.opening_price) / data.opening_price) * 100
      : null);

  // Contract suggestion
  const suggestion = (() => {
    if (isAboveHigh && orbHigh > 0) {
      const nextFib = fibLevels.above.find(l => l.price > currentPrice);
      return {
        type: 'CALL',
        icon: 'trending-up' as const,
        color: colors.success,
        bg: colors.success + '18',
        border: colors.success + '50',
        headline: 'Consider CALL Options',
        context: `+$${distFromORH!.toFixed(2)} above ORH — bullish extension`,
        target: nextFib ? `Next Fib target: $${nextFib.price.toFixed(2)} (${nextFib.multiplier}×)` : 'Beyond Fib 2× extension',
      };
    }
    if (isBelowLow && orbLow > 0) {
      const nextFib = fibLevels.below.find(l => l.price < currentPrice);
      return {
        type: 'PUT',
        icon: 'trending-down' as const,
        color: colors.error,
        bg: colors.error + '18',
        border: colors.error + '50',
        headline: 'Consider PUT Options',
        context: `-$${distFromORL!.toFixed(2)} below ORL — bearish extension`,
        target: nextFib ? `Next Fib target: $${nextFib.price.toFixed(2)} (${nextFib.multiplier}×)` : 'Beyond Fib 2× extension',
      };
    }
    if (data.breakout_type.includes('Bullish')) {
      return {
        type: 'CALL',
        icon: 'arrow-up-circle' as const,
        color: colors.success,
        bg: colors.success + '18',
        border: colors.success + '50',
        headline: 'Watch ORH for CALL Entry',
        context: `Bullish signal — ORH at $${orbHigh.toFixed(2)}`,
        target: `Confirm break + hold above ORH`,
      };
    }
    if (data.breakout_type.includes('Bearish')) {
      return {
        type: 'PUT',
        icon: 'arrow-down-circle' as const,
        color: colors.error,
        bg: colors.error + '18',
        border: colors.error + '50',
        headline: 'Watch ORL for PUT Entry',
        context: `Bearish signal — ORL at $${orbLow.toFixed(2)}`,
        target: `Confirm break + hold below ORL`,
      };
    }
    return {
      type: 'WAIT',
      icon: 'time-outline' as const,
      color: colors.textTertiary,
      bg: colors.surface,
      border: colors.border,
      headline: 'Awaiting Breakout',
      context: `Price consolidating in ORB range`,
      target: `Watch ORH $${orbHigh.toFixed(2)} and ORL $${orbLow.toFixed(2)}`,
    };
  })();

  // ── ORB Range Bar ──────────────────────────────────────────────────────────
  const ORBRangeBar = () => {
    if (orbRange <= 0) return null;
    const orhPct = pct(orbHigh);
    const orlPct = pct(orbLow);
    const pricePct = pct(currentPrice);

    return (
      <View style={styles.rangeSection}>
        {/* Bar */}
        <View style={[styles.rangeBar, { backgroundColor: colors.surfaceSecondary }]}>
          {/* Zone tints */}
          {isInRange && (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.accent + '12' }]} />
          )}
          {isAboveHigh && (
            <View style={[StyleSheet.absoluteFillObject, { left: `${orhPct}%`, backgroundColor: colors.success + '20' }]} />
          )}
          {isBelowLow && (
            <View style={[StyleSheet.absoluteFillObject, { right: `${100 - orlPct}%`, backgroundColor: colors.error + '20' }]} />
          )}

          {/* ORL line */}
          {(isInRange || isBelowLow) && (
            <View style={[styles.rangeLine, { left: `${orlPct}%`, backgroundColor: colors.error }]} />
          )}

          {/* ORH line */}
          {(isInRange || isAboveHigh) && (
            <View style={[styles.rangeLine, { left: `${orhPct}%`, backgroundColor: colors.success }]} />
          )}

          {/* Fibonacci lines */}
          {isAboveHigh && fibLevels.above.map(l => (
            <View key={l.multiplier} style={[styles.fibLine, { left: `${pct(l.price)}%`, backgroundColor: l.color }]} />
          ))}
          {isBelowLow && fibLevels.below.map(l => (
            <View key={l.multiplier} style={[styles.fibLine, { left: `${pct(l.price)}%`, backgroundColor: l.color }]} />
          ))}

          {/* Price marker */}
          <View style={[styles.priceMarker, { left: `${pricePct}%`, backgroundColor: priceColor }]} />

          {/* Price label floating on bar */}
          <View style={[styles.priceBubbleWrap, { left: `${pricePct}%` }]}>
            <View style={[styles.priceBubble, { backgroundColor: priceColor }]}>
              <Text style={styles.priceBubbleText}>${currentPrice.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Labels below bar */}
        <View style={styles.barLabelRow}>
          {/* ORL label */}
          {(isInRange || isBelowLow) && (
            <View style={[styles.barLabelPin, { left: `${orlPct}%` }]}>
              <Text style={[styles.barLabelTop, { color: colors.error }]}>ORL</Text>
              <Text style={[styles.barLabelBot, { color: colors.error }]}>{fp(orbLow)}</Text>
            </View>
          )}
          {/* ORH label */}
          {(isInRange || isAboveHigh) && (
            <View style={[styles.barLabelPin, { left: `${orhPct}%` }]}>
              <Text style={[styles.barLabelTop, { color: colors.success }]}>ORH</Text>
              <Text style={[styles.barLabelBot, { color: colors.success }]}>{fp(orbHigh)}</Text>
            </View>
          )}
          {/* Fibonacci labels */}
          {isAboveHigh && fibLevels.above.map(l => (
            <View key={l.multiplier} style={[styles.barLabelPin, { left: `${pct(l.price)}%` }]}>
              <Text style={[styles.barLabelTop, { color: l.color }]}>{l.label}</Text>
              <Text style={[styles.barLabelBot, { color: l.color }]}>${l.price.toFixed(0)}</Text>
            </View>
          ))}
          {isBelowLow && fibLevels.below.map(l => (
            <View key={l.multiplier} style={[styles.barLabelPin, { left: `${pct(l.price)}%` }]}>
              <Text style={[styles.barLabelTop, { color: l.color }]}>{l.label}</Text>
              <Text style={[styles.barLabelBot, { color: l.color }]}>${l.price.toFixed(0)}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  // ── Tab content ────────────────────────────────────────────────────────────

  const OverviewTab = () => (
    <View style={styles.tabContent}>
      {/* Contract Suggestion */}
      <View style={[styles.suggestionCard, { backgroundColor: suggestion.bg, borderColor: suggestion.border }]}>
        <View style={styles.suggestionLeft}>
          <Ionicons name={suggestion.icon} size={22} color={suggestion.color} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <Text style={[styles.suggestionHeadline, { color: suggestion.color }]}>
              {suggestion.headline}
            </Text>
            <View style={[styles.typeBadge, { backgroundColor: suggestion.color + '25', borderColor: suggestion.color + '60' }]}>
              <Text style={[styles.typeBadgeText, { color: suggestion.color }]}>{suggestion.type}</Text>
            </View>
          </View>
          <Text style={[styles.suggestionContext, { color: colors.textSecondary }]}>{suggestion.context}</Text>
          {suggestion.target && (
            <Text style={[styles.suggestionTarget, { color: suggestion.color }]}>{suggestion.target}</Text>
          )}
        </View>
      </View>

      {/* Breakout status row */}
      {hasBreakout && (
        <View style={[styles.breakoutRow, { backgroundColor: bkColor + '15', borderColor: bkColor + '40' }]}>
          <View style={[styles.dot, { backgroundColor: bkColor }]} />
          <Text style={[styles.breakoutLabel, { color: bkColor }]}>{getBreakoutLabel(data.breakout_type)}</Text>
          {data.breakout_price != null && (
            <Text style={[styles.breakoutPrice, { color: colors.textSecondary }]}>@ {fp(data.breakout_price)}</Text>
          )}
        </View>
      )}

      {/* Stats grid */}
      <View style={[styles.statsGrid, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <StatItem label="Open" value={fp(data.opening_price)} colors={colors} />
        <View style={[styles.statDividerV, { backgroundColor: colors.separator }]} />
        <StatItem label="Prev Close" value={fp(data.previous_close)} colors={colors} />
        <View style={[styles.statDividerV, { backgroundColor: colors.separator }]} />
        <StatItem
          label="Change"
          value={pctChange != null ? `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%` : 'N/A'}
          valueColor={pctChange != null ? (pctChange >= 0 ? colors.success : colors.error) : undefined}
          colors={colors}
        />
        <View style={[styles.statDividerH, { backgroundColor: colors.separator }]} />
        <StatItem label="Volume" value={fv(data.volume)} colors={colors} />
        <View style={[styles.statDividerV, { backgroundColor: colors.separator }]} />
        <StatItem label="Range" value={orbRange > 0 ? fp(orbRange) : 'N/A'} colors={colors} />
        <View style={[styles.statDividerV, { backgroundColor: colors.separator }]} />
        <StatItem
          label="vs ORH/ORL"
          value={isAboveHigh ? `+${fp(distFromORH!)}` : isBelowLow ? `-${fp(distFromORL!)}` : 'In Range'}
          valueColor={isAboveHigh ? colors.success : isBelowLow ? colors.error : colors.textSecondary}
          colors={colors}
        />
      </View>

      {/* Gap / trend context */}
      {gapTrendContext && gapTrendContext.gap_direction != null && (
        <View style={[styles.gapRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <GapTrendBadges context={gapTrendContext} compact />
        </View>
      )}

      {/* EMA Trend Zone */}
      {tech && !(tech as any).error && (
        <View style={styles.techPanel}>
          <View style={styles.techHeader}>
            <Text style={styles.techTitle}>EMA TREND ZONE</Text>
            <EMAZoneBadge zone={tech.zone} />
          </View>
          <View style={styles.emaRow}>
            <EMALine label="EMA 20" value={tech.ema20} current={tech.current_price} />
            {tech.ema50  != null && <EMALine label="EMA 50"  value={tech.ema50}  current={tech.current_price} />}
            {tech.ema200 != null && <EMALine label="EMA 200" value={tech.ema200} current={tech.current_price} />}
          </View>
          <View style={styles.emaStats}>
            <StatChip label="RSI" value={tech.rsi.toFixed(1)} />
            <StatChip label="ATR" value={`$${tech.atr.toFixed(2)}`} />
            <StatChip label="Dist EMA20" value={`${tech.dist_from_ema20_pct.toFixed(1)}%`} />
            <StatChip label="MACD" value={tech.macd_above_signal ? '▲ Above' : '▼ Below'} positive={tech.macd_above_signal} />
          </View>
        </View>
      )}
    </View>
  );

  const LevelsTab = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {/* ORB Key Levels */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textTertiary }]}>ORB Key Levels</Text>
        <Row label="ORB High" value={fp(orbHigh)} valueColor={colors.success} colors={colors} />
        <Divider colors={colors} />
        <Row label="ORB Low" value={fp(orbLow)} valueColor={colors.error} colors={colors} />
        <Divider colors={colors} />
        <Row label="Range" value={orbRange > 0 ? fp(orbRange) : 'N/A'} colors={colors} />
        <Divider colors={colors} />
        <Row label="Opening Price" value={fp(data.opening_price)} colors={colors} />
        {data.previous_close != null && (
          <>
            <Divider colors={colors} />
            <Row label="Prev Close" value={fp(data.previous_close)} colors={colors} />
          </>
        )}
      </View>

      {/* Fibonacci extensions */}
      {isAboveHigh && fibLevels.above.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textTertiary }]}>Fibonacci Extensions (above ORH)</Text>
          {fibLevels.above.map((l, i) => (
            <React.Fragment key={l.multiplier}>
              {i > 0 && <Divider colors={colors} />}
              <View style={styles.row}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.fibDot, { backgroundColor: l.color }]} />
                  <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>Fib {l.label} · T{i + 1}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.rowValue, { color: l.color }]}>{fp(l.price)}</Text>
                  {currentPrice >= l.price && (
                    <Text style={{ fontSize: 10, color: l.color, fontWeight: '600' }}>✓ Reached</Text>
                  )}
                </View>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {isBelowLow && fibLevels.below.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textTertiary }]}>Fibonacci Extensions (below ORL)</Text>
          {fibLevels.below.map((l, i) => (
            <React.Fragment key={l.multiplier}>
              {i > 0 && <Divider colors={colors} />}
              <View style={styles.row}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.fibDot, { backgroundColor: l.color }]} />
                  <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>Fib {l.label} · T{i + 1}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.rowValue, { color: l.color }]}>{fp(l.price)}</Text>
                  {currentPrice <= l.price && (
                    <Text style={{ fontSize: 10, color: l.color, fontWeight: '600' }}>✓ Reached</Text>
                  )}
                </View>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {!isAboveHigh && !isBelowLow && orbRange > 0 && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textTertiary }]}>Fibonacci Targets (on breakout)</Text>
          <Text style={[styles.cardNote, { color: colors.textTertiary }]}>
            Bullish break above ORH — CALL targets:
          </Text>
          {fibLevels.above.map((l, i) => (
            <React.Fragment key={`a-${l.multiplier}`}>
              {i > 0 && <Divider colors={colors} />}
              <Row label={`T${i + 1} · Fib ${l.label}`} value={fp(l.price)} valueColor={colors.success} colors={colors} />
            </React.Fragment>
          ))}
          <View style={[styles.cardSectionDivider, { backgroundColor: colors.separator }]} />
          <Text style={[styles.cardNote, { color: colors.textTertiary }]}>
            Bearish break below ORL — PUT targets:
          </Text>
          {fibLevels.below.map((l, i) => (
            <React.Fragment key={`b-${l.multiplier}`}>
              {i > 0 && <Divider colors={colors} />}
              <Row label={`T${i + 1} · Fib ${l.label}`} value={fp(l.price)} valueColor={colors.error} colors={colors} />
            </React.Fragment>
          ))}
        </View>
      )}
    </ScrollView>
  );

  const DetailsTab = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.tabContent, { paddingBottom: 32 }]} showsVerticalScrollIndicator={false}>
      {/* Trade Info */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.textTertiary }]}>Trade Info</Text>
        <Row label="Trade Date" value={fd(data.trade_date)} colors={colors} />
        {data.timestamp && <><Divider colors={colors} /><Row label="Last Update" value={ft(data.timestamp)} colors={colors} /></>}
        {data.data_source && <><Divider colors={colors} /><Row label="Data Source" value={data.data_source} colors={colors} /></>}
        <Divider colors={colors} />
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>Status</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.dot, { backgroundColor: data.monitoring_active ? colors.success : colors.error }]} />
            <Text style={[styles.rowValue, { color: data.monitoring_active ? colors.success : colors.error }]}>
              {data.monitoring_active ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
        {(data.high_broken || data.low_broken) && (
          <>
            <Divider colors={colors} />
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>Flags</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {data.high_broken && (
                  <Text style={{ color: colors.success, fontSize: 12, fontWeight: '600' }}>High ✓</Text>
                )}
                {data.low_broken && (
                  <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>Low ✓</Text>
                )}
              </View>
            </View>
          </>
        )}
      </View>

      {/* Options data */}
      {data.options_data && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textTertiary }]}>Options Data</Text>
          {Object.entries(data.options_data).map(([k, v], i) => (
            <React.Fragment key={k}>
              {i > 0 && <Divider colors={colors} />}
              <Row
                label={k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                value={typeof v === 'number' ? fp(v) : String(v)}
                colors={colors}
              />
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Notification preferences — only meaningful for an actively followed ticker */}
      {followState?.orb_enabled && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.notifCardHeader}>
            <Text style={[styles.cardTitle, { color: colors.textTertiary, marginBottom: 0 }]}>Notifications</Text>
            <TouchableOpacity
              onPress={() => updateNotificationTypes.mutate({
                notify_confirmed_breakout: !notifAllOn,
                notify_reversal: !notifAllOn,
              })}
              disabled={updateNotificationTypes.isPending}
              hitSlop={6}
            >
              <Text style={[styles.notifSelectAll, { color: colors.accent }]}>
                {notifAllOn ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.notifRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.text, fontWeight: '600' }]}>Breakout Confirmed</Text>
              <Text style={[styles.notifDesc, { color: colors.textTertiary }]}>
                Push when a break holds through confirmation — the actionable entry signal.
              </Text>
            </View>
            <Switch
              value={notifyConfirmed}
              onValueChange={(v) => updateNotificationTypes.mutate({ notify_confirmed_breakout: v })}
              disabled={updateNotificationTypes.isPending}
              trackColor={{ true: colors.success, false: colors.border }}
            />
          </View>
          <Divider colors={colors} />
          <View style={styles.notifRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.text, fontWeight: '600' }]}>Reversal Detected</Text>
              <Text style={[styles.notifDesc, { color: colors.textTertiary }]}>
                Push when a confirmed breakout fails and reverses direction.
              </Text>
            </View>
            <Switch
              value={notifyReversal}
              onValueChange={(v) => updateNotificationTypes.mutate({ notify_reversal: v })}
              disabled={updateNotificationTypes.isPending}
              trackColor={{ true: colors.success, false: colors.border }}
            />
          </View>
        </View>
      )}

      {/* Unfollow / navigate actions */}
      <View style={{ gap: 10 }}>
        {data.monitoring_active && (
          <TouchableOpacity
            onPress={handleUnfollow}
            disabled={setMonitoringActive.isPending}
            style={[styles.actionBtn, { backgroundColor: colors.error + '15', borderColor: colors.error + '50' }]}
          >
            {setMonitoringActive.isPending
              ? <ActivityIndicator size="small" color={colors.error} />
              : <Ionicons name="remove-circle-outline" size={18} color={colors.error} />}
            <Text style={[styles.actionBtnText, { color: colors.error }]}>
              {setMonitoringActive.isPending ? 'Removing…' : 'Remove from ORB list'}
            </Text>
          </TouchableOpacity>
        )}
        {onNavigateToTicker && (
          <TouchableOpacity
            onPress={() => { onNavigateToTicker(data.ticker); onClose(); }}
            style={[styles.actionBtn, { backgroundColor: colors.accent + '20', borderColor: colors.accent + '50' }]}
          >
            <Ionicons name="open-outline" size={18} color={colors.accent} />
            <Text style={[styles.actionBtnText, { color: colors.accent }]}>View {data.ticker} Details</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>

        {/* Drag handle */}
        <View style={[styles.dragHandle, { backgroundColor: colors.surfaceTertiary }]} />

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.separator }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Text style={[styles.ticker, { color: colors.text }]}>{data.ticker}</Text>
              {/* Suggestion type pill */}
              <View style={[styles.typeBadge, { backgroundColor: suggestion.color + '25', borderColor: suggestion.color + '60' }]}>
                <Text style={[styles.typeBadgeText, { color: suggestion.color }]}>{suggestion.type}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AnimatedNumber
                value={currentPrice}
                format={v => `$${v.toFixed(2)}`}
                style={styles.price}
                color={priceColor}
              />
              <Text style={[styles.pricePosition, { color: priceColor }]}>
                {isAboveHigh && `▲ $${distFromORH!.toFixed(2)} above ORH`}
                {isBelowLow && `▼ $${distFromORL!.toFixed(2)} below ORL`}
                {isInRange && '↔ In ORB Range'}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* ORB Range Bar */}
        <ORBRangeBar />

        {/* Tab bar */}
        <View style={[styles.tabRow, { borderBottomColor: colors.separator }]}>
          {(['Overview', 'Levels', 'Details'] as Tab[]).map(tab => {
            const active = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.tabBtn, active && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
                activeOpacity={0.75}
              >
                <Text style={[styles.tabBtnText, { color: active ? colors.accent : colors.textTertiary }]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Tab content */}
        <View style={{ flex: 1 }}>
          {activeTab === 'Overview' && <OverviewTab />}
          {activeTab === 'Levels' && <LevelsTab />}
          {activeTab === 'Details' && <DetailsTab />}
        </View>

      </SafeAreaView>
    </Modal>
  );
};

// ─── EMA sub-components ───────────────────────────────────────────────────────

function EMALine({ label, value, current }: { label: string; value: number; current: number }) {
  const above = current > value;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={{ color: '#94A3B8', fontSize: 12 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Text style={{ color: '#F1F5F9', fontSize: 12, fontVariant: ['tabular-nums'] }}>${value.toFixed(2)}</Text>
        <Text style={{ color: above ? '#10B981' : '#EF4444', fontSize: 10 }}>{above ? '▲ above' : '▼ below'}</Text>
      </View>
    </View>
  );
}

function StatChip({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const color = positive === undefined ? '#94A3B8' : positive ? '#10B981' : '#EF4444';
  return (
    <View style={{ backgroundColor: '#1E293B', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: '#64748B', fontSize: 9, marginBottom: 1 }}>{label}</Text>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

// ─── StatItem ─────────────────────────────────────────────────────────────────

const StatItem = ({
  label, value, valueColor, colors,
}: {
  label: string; value: string; valueColor?: string; colors: ReturnType<typeof useThemeColors>;
}) => (
  <View style={styles.statItem}>
    <Text style={[styles.statValue, { color: valueColor ?? colors.text }]} numberOfLines={1}>{value}</Text>
    <Text style={[styles.statLabel, { color: colors.textTertiary }]} numberOfLines={1}>{label}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  dragHandle: {
    width: 36, height: 4, borderRadius: 2,
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },

  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ticker: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  price: { fontSize: 22, fontWeight: '700' },
  pricePosition: { fontSize: 13, fontWeight: '500' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },

  // ORB Range Bar
  rangeSection: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  rangeBar: {
    height: 88, borderRadius: 12, overflow: 'hidden', position: 'relative',
  },
  rangeLine: {
    position: 'absolute', top: 0, bottom: 0, width: 2,
  },
  fibLine: {
    position: 'absolute', top: 0, bottom: 0, width: 1.5,
  },
  priceMarker: {
    position: 'absolute', top: 0, bottom: 0, width: 3, borderRadius: 2,
  },
  priceBubbleWrap: {
    position: 'absolute', top: 8, transform: [{ translateX: -32 }],
  },
  priceBubble: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
  },
  priceBubbleText: {
    fontSize: 11, fontWeight: '700', color: '#fff',
  },
  barLabelRow: {
    position: 'relative', height: 36, marginTop: 4,
  },
  barLabelPin: {
    position: 'absolute', top: 0, transform: [{ translateX: -18 }],
    alignItems: 'center',
  },
  barLabelTop: { fontSize: 10, fontWeight: '600' },
  barLabelBot: { fontSize: 10, fontWeight: '500' },

  // Tabs
  tabRow: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  tabBtn: {
    flex: 1, paddingVertical: 11, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnText: { fontSize: 13, fontWeight: '600' },

  // Tab content
  tabContent: { padding: 16, gap: 12 },

  // Suggestion card
  suggestionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  suggestionLeft: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  suggestionHeadline: { fontSize: 14, fontWeight: '700' },
  suggestionContext: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  suggestionTarget: { fontSize: 12, fontWeight: '600', marginTop: 5 },

  typeBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '700' },

  // Breakout row
  breakoutRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  breakoutLabel: { fontSize: 13, fontWeight: '600', flex: 1 },
  breakoutPrice: { fontSize: 12, fontWeight: '500' },

  dot: { width: 8, height: 8, borderRadius: 4 },

  // Stats grid
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    borderRadius: 14, borderWidth: 1, overflow: 'hidden',
  },
  statItem: {
    width: '33.33%', paddingVertical: 12, paddingHorizontal: 14,
    alignItems: 'flex-start',
  },
  statValue: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  statLabel: { fontSize: 11, fontWeight: '500' },
  statDividerV: { width: StyleSheet.hairlineWidth, marginVertical: 10 },
  statDividerH: { width: '100%', height: StyleSheet.hairlineWidth },

  // Gap row
  gapRow: {
    padding: 12, borderRadius: 12, borderWidth: 1,
  },

  // Cards (Levels + Details)
  card: {
    borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 0,
  },
  cardTitle: {
    fontSize: 11, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.6, marginBottom: 12,
  },
  cardNote: {
    fontSize: 12, fontWeight: '500', marginBottom: 8,
  },
  cardSectionDivider: {
    height: 1, marginVertical: 14,
  },

  fibDot: { width: 8, height: 8, borderRadius: 4 },

  // Rows
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 13, fontWeight: '500' },
  rowValue: { fontSize: 15, fontWeight: '600' },

  // Notification preferences card
  notifCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  notifSelectAll: { fontSize: 12, fontWeight: '600' },
  notifRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  notifDesc: { fontSize: 11.5, fontWeight: '400', marginTop: 2, lineHeight: 15 },

  // EMA panel
  techPanel:  { marginTop: 4, backgroundColor: '#0F172A', borderRadius: 10, padding: 12, gap: 8 },
  techHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  techTitle:  { color: '#64748B', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  emaRow:     { gap: 2 },
  emaStats:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },

  // Action buttons
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 13, borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
});
