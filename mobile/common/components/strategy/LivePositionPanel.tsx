import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EditExitsButton } from '@/common/components/shared/EditExitsButton';
import { formatContractSymbolShort, getTradeHorizon } from '@/lib/formatContract';
import { isMarketHours } from '@/lib/marketHours';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';

/** LivePriceData plus the market_value the header displays — computed via
 *  fallback (mid_price * qty_remaining * 100) since the live WS payload
 *  doesn't declare it on the type (even though some payloads do include it). */
type DisplayData = LivePriceData & { market_value?: number };

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** REST-snapshot fields to show immediately, before (or if) the live WS ever ticks. */
export interface LivePositionStaticFallback {
  contract?: string;
  entry_premium?: number;
  mid_price?: number;
  qty_remaining?: number;
  pnl?: number;
  pnl_pct?: number;
  hard_stop?: number;
  tp1?: number;
  tp2?: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
}

interface LivePositionPanelProps {
  live: LivePriceData | null | undefined;
  /** Shown immediately (and used if the WS never connects, e.g. mock/preview mode). */
  staticFallback?: LivePositionStaticFallback;
  streaming: boolean;
  /** True for a mock/preview position with no real WS to connect to — shows "PREVIEW" instead of LIVE/CONNECTING. */
  isMock?: boolean;
  accentColor: string;
  strategyId: string;
  ticker: string;
  paperMode?: boolean;
  onExitPress: () => void;
  /** Opens the add-to-position (average down/up) modal. Omit to hide the button
   *  entirely — used by surfaces that don't yet support adding to a position. */
  onAddPress?: () => void;
  colors: any;
}

/**
 * The same live-position display used for an active trade within a saved
 * Strategy (originally built inline in strategy.tsx's StrategyCard/
 * ImmediatePositionCard) — extracted here so the Live Positions page
 * (position.tsx) can show positions identically instead of the older,
 * static PositionCard. strategy.tsx is untouched; this is a fresh copy of
 * that same visual pattern so porting it carries no risk to the working
 * Strategy screen.
 */
export function LivePositionPanel({
  live, staticFallback, streaming, isMock, accentColor,
  strategyId, ticker, paperMode, onExitPress, onAddPress, colors,
}: LivePositionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  }, []);

  const hasFallback =
    staticFallback?.entry_premium != null &&
    staticFallback?.hard_stop != null &&
    staticFallback?.tp1 != null;

  // Merge live over the REST snapshot — the card renders immediately with
  // whatever position.tsx already had from its poll, then upgrades in place
  // the moment the WS connects, instead of a blank spinner the whole time.
  const display: DisplayData | undefined = live ?? (hasFallback
    ? {
        contract:      staticFallback!.contract ?? '',
        entry_premium: staticFallback!.entry_premium!,
        mid_price:     staticFallback!.mid_price ?? staticFallback!.entry_premium!,
        pnl:           staticFallback!.pnl ?? 0,
        pnl_pct:       staticFallback!.pnl_pct ?? 0,
        qty_remaining: staticFallback!.qty_remaining ?? 0,
        tp1_hit:       staticFallback!.tp1_hit ?? false,
        tp2_hit:       staticFallback!.tp2_hit ?? false,
        hard_stop:     staticFallback!.hard_stop!,
        tp1:           staticFallback!.tp1!,
        tp2:           staticFallback!.tp2 ?? staticFallback!.tp1!,
        market_value:  (staticFallback!.mid_price ?? staticFallback!.entry_premium!) * (staticFallback!.qty_remaining ?? 0) * 100,
      }
    : undefined);

  const pnlColor = display
    ? (display.pnl >= 0 ? colors.success : colors.error)
    : colors.tabBarInactive;

  // Outside market hours there's nothing to connect to — a swing/LEAPS
  // position held overnight or over a weekend would otherwise show
  // "CONNECTING" indefinitely, which reads as something being wrong rather
  // than the market simply being closed.
  const marketOpen  = isMarketHours();
  const statusLabel = isMock ? 'PREVIEW' : streaming ? 'LIVE' : marketOpen ? 'CONNECTING' : 'MARKET CLOSED';
  const statusColor = isMock ? colors.accent : streaming ? colors.success : colors.tabBarInactive;

  return (
    <View style={[styles.livePnlCard, { backgroundColor: colors.background, borderColor: accentColor + '44' }]}>
      {/* Header row: streaming dot + label + contract + P&L */}
      <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.7} style={styles.liveHeaderRow}>
        <View style={styles.liveHeaderLeft}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.liveLabel, { color: statusColor }]}>{statusLabel}</Text>
          {display && (
            <Text style={[styles.liveContract, { color: colors.tabBarInactive }]}>
              {formatContractSymbolShort(display.contract)}
            </Text>
          )}
          {display && getTradeHorizon(display.contract) === 'SWING' && (
            <View style={[styles.swingBadge, { backgroundColor: '#A855F722' }]}>
              <Text style={[styles.swingBadgeText, { color: '#A855F7' }]}>SWING</Text>
            </View>
          )}
        </View>
        {display && (
          <View style={styles.liveHeaderRight}>
            <Text style={[styles.livePnlValue, { color: pnlColor }]}>
              {display.pnl >= 0 ? '+' : ''}${display.pnl.toFixed(2)}
            </Text>
            <View style={[styles.pnlPctPill, { backgroundColor: pnlColor + '1A' }]}>
              <Text style={[styles.pnlPctText, { color: pnlColor }]}>
                {display.pnl_pct >= 0 ? '+' : ''}{display.pnl_pct.toFixed(1)}%
              </Text>
            </View>
            <Text style={[styles.mktValText, { color: colors.tabBarInactive }]}>
              Mkt ${(display.market_value ?? display.mid_price * display.qty_remaining * 100).toFixed(2)}
            </Text>
          </View>
        )}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.tabBarInactive}
          style={{ marginLeft: 8 }}
        />
      </TouchableOpacity>

      {/* Stats row: Price | Qty | Stop */}
      {display ? (
        <>
          <View style={styles.liveStats}>
            <LiveStat label="Entry" value={`$${display.entry_premium.toFixed(2)}`} colors={colors} />
            <LiveStat label="Price" value={`$${display.mid_price.toFixed(2)}`} colors={colors} highlight />
            <LiveStat label="Qty"   value={String(display.qty_remaining)} colors={colors} />
            <LiveStat label="Stop"  value={`$${display.hard_stop.toFixed(2)}`} colors={colors} valueColor={colors.error} />
          </View>

          {/* Stop/TP progression bar */}
          <PositionStopBar live={display} colors={colors} />

          {/* TP hit badges */}
          {(display.tp1_hit || display.tp2_hit) && (
            <View style={styles.tpRow}>
              {display.tp1_hit && (
                <View style={[styles.tpBadge, { backgroundColor: colors.success + '22' }]}>
                  <Text style={[styles.tpBadgeText, { color: colors.success }]}>TP1 ✓</Text>
                </View>
              )}
              {display.tp2_hit && (
                <View style={[styles.tpBadge, { backgroundColor: colors.success + '22' }]}>
                  <Text style={[styles.tpBadgeText, { color: colors.success }]}>TP2 ✓</Text>
                </View>
              )}
            </View>
          )}

          {/* Expanded detail */}
          {expanded && <LivePositionDetail live={display} colors={colors} />}
        </>
      ) : (
        <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
      )}

      {/* Edit exits + manual exit */}
      <View style={styles.liveActionsRow}>
        {display && !isMock && (
          <EditExitsButton
            mode="orb"
            strategy_id={strategyId}
            ticker={ticker}
            hard_stop={display.hard_stop}
            tp1={display.tp1}
            tp2={display.tp2}
            entry_premium={display.entry_premium}
            tp1_hit={display.tp1_hit}
            tp2_hit={display.tp2_hit}
            style={{ flex: 1 }}
          />
        )}
        {!isMock && onAddPress && (
          <TouchableOpacity
            onPress={onAddPress}
            activeOpacity={0.8}
            style={[styles.exitBtn, { flex: 1, marginTop: 0, borderColor: accentColor + '55', backgroundColor: accentColor + '14' }]}
          >
            <Ionicons name="add-circle-outline" size={16} color={accentColor} />
            <Text style={[styles.exitBtnText, { color: accentColor }]}>Add</Text>
          </TouchableOpacity>
        )}
        {!isMock && (
          <TouchableOpacity
            onPress={onExitPress}
            activeOpacity={0.8}
            style={[styles.exitBtn, { flex: 1, marginTop: 0, borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
          >
            <Ionicons name="exit-outline" size={16} color={colors.error} />
            <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function PositionStopBar({ live, colors }: { live: DisplayData; colors: any }) {
  const stages = [
    { label: 'Stop', value: live.hard_stop, active: !live.tp1_hit, color: colors.error },
    { label: 'TP1',  value: live.tp1,       active: live.tp1_hit && !live.tp2_hit, color: '#4A9EFF' },
    { label: 'TP2',  value: live.tp2,       active: live.tp2_hit, color: colors.success },
  ];
  return (
    <View style={styles.stopBar}>
      {stages.map((s, i) => (
        <View key={i} style={styles.stopStage}>
          <View style={[styles.stopDot, { backgroundColor: s.active ? s.color : colors.border }]} />
          <Text style={[styles.stopLabel, { color: s.active ? s.color : colors.tabBarInactive }]}>{s.label}</Text>
          <Text style={[styles.stopValue, { color: colors.tabBarInactive }]}>${s.value.toFixed(2)}</Text>
        </View>
      ))}
    </View>
  );
}

function LivePositionDetail({ live, colors }: { live: DisplayData; colors: any }) {
  return (
    <View style={[styles.liveDetail, { borderTopColor: colors.border }]}>
      <LiveDetailRow label="Entry"     value={`$${live.entry_premium.toFixed(2)}`} colors={colors} />
      <LiveDetailRow label="Hard Stop" value={`$${live.hard_stop.toFixed(2)}`} valueColor={colors.error} colors={colors} />
      <LiveDetailRow label="TP1" value={`$${live.tp1.toFixed(2)}`} badge={live.tp1_hit ? 'Hit' : undefined} badgeColor={colors.success} colors={colors} />
      <LiveDetailRow label="TP2" value={`$${live.tp2.toFixed(2)}`} badge={live.tp2_hit ? 'Hit' : undefined} badgeColor={colors.success} colors={colors} />
    </View>
  );
}

function LiveDetailRow({ label, value, valueColor, badge, badgeColor, colors }: {
  label: string; value: string; valueColor?: string; badge?: string; badgeColor?: string; colors: any;
}) {
  return (
    <View style={styles.liveDetailRow}>
      <Text style={[styles.liveDetailLabel, { color: colors.tabBarInactive }]}>{label}</Text>
      <View style={styles.liveDetailRight}>
        <Text style={[styles.liveDetailValue, { color: valueColor ?? colors.text }]}>{value}</Text>
        {badge && (
          <View style={[styles.liveDetailBadge, { backgroundColor: (badgeColor ?? colors.accent) + '22' }]}>
            <Text style={[styles.liveDetailBadgeText, { color: badgeColor ?? colors.accent }]}>{badge}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const LiveStat = ({ label, value, colors, highlight, valueColor }: {
  label: string; value: string; colors: any; highlight?: boolean; valueColor?: string;
}) => (
  <View style={styles.liveStat}>
    <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.liveStatValue, { color: valueColor ?? (highlight ? colors.accent : colors.text) }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  livePnlCard:     { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10 },
  liveHeaderRow:   { flexDirection: 'row', alignItems: 'center' },
  liveHeaderLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  liveHeaderRight: { alignItems: 'flex-end', gap: 2 },
  statusDot:       { width: 6, height: 6, borderRadius: 3 },
  liveLabel:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  liveContract:    { fontSize: 11, fontFamily: 'monospace' },
  swingBadge:      { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  swingBadgeText:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  livePnlValue:    { fontSize: 15, fontWeight: '700' },
  pnlPctPill:      { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  pnlPctText:      { fontSize: 10, fontWeight: '700' },
  mktValText:      { fontSize: 10, marginTop: 1 },

  liveStats:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  liveStat:       { alignItems: 'center', flex: 1 },
  liveStatLabel:  { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  liveStatValue:  { fontSize: 13, fontWeight: '700' },

  stopBar:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 6 },
  stopStage: { flex: 1, alignItems: 'center', gap: 2 },
  stopDot:   { width: 6, height: 6, borderRadius: 3 },
  stopLabel: { fontSize: 9, fontWeight: '700' },
  stopValue: { fontSize: 10 },

  tpRow:       { flexDirection: 'row', gap: 6, marginTop: 8 },
  tpBadge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tpBadgeText: { fontSize: 10, fontWeight: '700' },

  liveDetail:      { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, gap: 6 },
  liveDetailRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveDetailLabel: { fontSize: 12 },
  liveDetailRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDetailValue: { fontSize: 12, fontWeight: '600' },
  liveDetailBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  liveDetailBadgeText: { fontSize: 10, fontWeight: '700' },

  liveActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  exitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 8, paddingVertical: 9,
  },
  exitBtnText: { fontSize: 13, fontWeight: '700' },
});
