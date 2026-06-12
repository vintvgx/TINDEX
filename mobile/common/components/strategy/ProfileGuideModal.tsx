import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ProfileGuideModalProps {
  visible: boolean;
  onClose: () => void;
  colors: any;
}

const PROFILES: ProfileGuide[] = [
  {
    key: 'BULL_DOG',
    emoji: '🐂',
    name: 'Bull Dog',
    color: '#FF6B35',
    tagline: 'High-conviction momentum. Go big or go home.',
    entryMode: 'BREAK',
    risk: 'High',
    riskColor: '#EF4444',
    contracts: 10,
    stop: 40,
    tp1: 75,
    tp2: 150,
    tp1Close: 30,
    tp2Close: 30,
    runnerPct: 40,
    vixMax: 35,
    window: 60,
    concept: 'Enters immediately on ORB breakout with maximum size. Designed for days with strong directional conviction. Keeps 40% of contracts running with a wide trail for outsized gains.',
    pros: [
      'Highest absolute dollar P&L on trend days',
      'Wide VIX tolerance — trades in volatile markets',
      'Runner captures explosive moves (200%+ gains)',
    ],
    cons: [
      'Largest losses when breakout fails',
      'Requires significant account size ($3K+ per trade)',
      'Emotionally difficult — large swings',
    ],
    bestFor: 'Strong trend days, low VIX environments, SPY/QQQ, high-conviction setups',
    avoid: 'Choppy/range-bound markets, high VIX (>30), small accounts',
  },
  {
    key: 'THUNDER_CAT',
    emoji: '🐱',
    name: 'Thunder Cat',
    color: '#4A9EFF',
    tagline: 'Balanced all-weather. The default for a reason.',
    entryMode: 'BREAK',
    risk: 'Medium',
    riskColor: '#F59E0B',
    contracts: 6,
    stop: 35,
    tp1: 50,
    tp2: 100,
    tp1Close: 50,
    tp2Close: 50,
    runnerPct: 0,
    vixMax: 30,
    window: 45,
    concept: 'The system default. Enters on ORB breakout with 6 contracts, takes profit aggressively at TP1 to de-risk, then exits the rest at TP2. Balanced between capturing moves and protecting gains.',
    pros: [
      'Best overall win rate among all profiles',
      'Consistent, repeatable results across market conditions',
      'Quick de-risk at TP1 locks in gains early',
    ],
    cons: [
      'Fully exits at TP2 — misses the full trend day move',
      'Average winner capped relative to potential',
      'Tight breakout window (45 min) misses some setups',
    ],
    bestFor: 'Daily trading on any ticker, learning the system, all market conditions',
    avoid: 'None — this profile works across all conditions by design',
  },
  {
    key: 'WOLF',
    emoji: '🐺',
    name: 'Wolf',
    color: '#4CAF84',
    tagline: 'Capital preservation first. Tight stops, quick exits.',
    entryMode: 'BREAK',
    risk: 'Low',
    riskColor: '#22C55E',
    contracts: 3,
    stop: 25,
    tp1: 35,
    tp2: 70,
    tp1Close: 67,
    tp2Close: 100,
    runnerPct: 0,
    vixMax: 25,
    window: 35,
    concept: 'Conservative profile designed to protect capital above all else. Closes 67% of the position at the first TP, and fully exits at TP2. No runner. Small losses when wrong.',
    pros: [
      'Tightest stop — smallest losses per trade',
      'Highest percentage of position exited early',
      'Predictable, low-stress trading',
    ],
    cons: [
      'No runner — completely exits at TP2, misses trend continuation',
      'Lowest absolute P&L even on winning days',
      'Tight window (35 min) means fewer entries',
    ],
    bestFor: 'Small accounts (<$1K), high VIX environments, choppy conditions, risk-averse traders',
    avoid: 'Trend days where a runner would significantly outperform',
  },
  {
    key: 'TREND_RIDER',
    emoji: '🚀',
    name: 'Trend Rider',
    color: '#A855F7',
    tagline: 'Built for the full move. Hold most contracts all the way.',
    entryMode: 'BREAK',
    risk: 'Medium-High',
    riskColor: '#F97316',
    contracts: 2,
    stop: 38,
    tp1: 60,
    tp2: 150,
    tp1Close: 15,
    tp2Close: 35,
    runnerPct: 50,
    vixMax: 21,
    window: 90,
    concept: 'Designed around the observation that ~28% of trading days produce a clean directional trend where IWM moves 1.2%+ from open to close. On those days, ATM 0DTE options can gain 300-500%. This profile keeps 50% of contracts running with a wide trail to capture that full move.',
    pros: [
      'Captures 200-500% gains on genuine trend days',
      'Profit factor 2.0-2.5x when conditions are right',
      '90-min breakout window — patient entry',
    ],
    cons: [
      'Lower win rate (~42-48%) — accept more losers',
      'Frustrating on sideways days (you hold through nothing)',
      'Only 2 contracts — low absolute P&L in dollars',
    ],
    bestFor: 'IWM on macro catalyst days, VIX 16-21, clear directional sentiment in pre-market',
    avoid: 'Choppy/consolidating markets, VIX >21, days with no clear catalyst',
    badge: 'IWM Optimized',
  },
  {
    key: 'RETESTER',
    emoji: '🎯',
    name: 'Retester',
    color: '#06B6D4',
    tagline: 'Never chases. Waits for the breakout to prove itself.',
    entryMode: 'RETEST',
    risk: 'Medium',
    riskColor: '#F59E0B',
    contracts: 4,
    stop: 30,
    tp1: 50,
    tp2: 100,
    tp1Close: 55,
    tp2Close: 35,
    runnerPct: 10,
    vixMax: 28,
    window: 90,
    concept: 'Instead of entering on the breakout, waits for price to extend past ORH/ORL then PULL BACK to retest that level. Enters only when the level holds as support/resistance. This eliminates the majority of false-breakout losses that plague the other profiles.',
    pros: [
      '62-68% win rate vs 52-55% for immediate entry profiles',
      'Enters near a defined S/R level — stop is very logical',
      'Tight 30% stop relative to the quality of entry',
    ],
    cons: [
      'Misses ~20% of trades (fast trend days that never pull back)',
      'Requires up to 90-min window for the retest to set up',
      'More complex — can timeout without a trade',
    ],
    bestFor: 'IWM (high retest frequency), choppy conditions, any day you want higher probability over volume',
    avoid: 'Explosive catalyst days where price runs and never looks back',
    badge: 'IWM Optimized',
    isNew: true,
  },
  {
    key: 'CUSTOM',
    emoji: '⚙️',
    name: 'Custom',
    color: '#A855F7',
    tagline: 'Full control over every parameter.',
    entryMode: 'BREAK',
    risk: 'Custom',
    riskColor: '#8B5CF6',
    contracts: 0,
    stop: 0,
    tp1: 0,
    tp2: 0,
    tp1Close: 0,
    tp2Close: 0,
    runnerPct: 0,
    vixMax: 0,
    window: 0,
    concept: 'Configure every parameter yourself — contracts, stop loss, take-profit multipliers, partial close percentages, timing windows, delta range, and more. Best used once you understand the other profiles.',
    pros: [
      'Complete flexibility for any strategy or thesis',
      'Can combine ideas from multiple profiles',
      'Adapt parameters as market conditions change',
    ],
    cons: [
      'Requires knowledge of what each parameter does',
      'Easy to over-optimize ("curve fit") on past data',
      'No guardrails — all parameter risk is on you',
    ],
    bestFor: 'Experienced traders who want to test specific hypotheses',
    avoid: 'Starting out — use a named profile first to understand the system',
  },
];

interface ProfileGuide {
  key: string;
  emoji: string;
  name: string;
  color: string;
  tagline: string;
  entryMode: 'BREAK' | 'RETEST';
  risk: string;
  riskColor: string;
  contracts: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp1Close: number;
  tp2Close: number;
  runnerPct: number;
  vixMax: number;
  window: number;
  concept: string;
  pros: string[];
  cons: string[];
  bestFor: string;
  avoid: string;
  badge?: string;
  isNew?: boolean;
}

export function ProfileGuideModal({ visible, onClose, colors }: ProfileGuideModalProps) {
  const [selected, setSelected] = useState<ProfileGuide>(PROFILES[1]); // Thunder Cat default

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <Text style={[s.headerTitle, { color: colors.text }]}>Profile Guide</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.tabBarInactive} />
          </TouchableOpacity>
        </View>

        {/* Horizontal profile selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[s.selectorRow, { borderBottomColor: colors.border }]}
          contentContainerStyle={s.selectorContent}
        >
          {PROFILES.map(p => {
            const active = selected.key === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                onPress={() => setSelected(p)}
                activeOpacity={0.7}
                style={[
                  s.selectorChip,
                  { borderColor: active ? p.color : colors.border,
                    backgroundColor: active ? p.color + '22' : 'transparent' },
                ]}
              >
                <Text style={s.selectorEmoji}>{p.emoji}</Text>
                <Text style={[s.selectorLabel, { color: active ? p.color : colors.tabBarInactive }]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Detail scroll */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.detail}
        >
          {/* Hero */}
          <View style={[s.hero, { borderLeftColor: selected.color, backgroundColor: selected.color + '0D' }]}>
            <View style={s.heroTop}>
              <Text style={s.heroEmoji}>{selected.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={s.heroNameRow}>
                  <Text style={[s.heroName, { color: colors.text }]}>{selected.name}</Text>
                  {selected.isNew && (
                    <View style={[s.newBadge, { backgroundColor: selected.color }]}>
                      <Text style={s.newBadgeText}>NEW</Text>
                    </View>
                  )}
                  {selected.badge && (
                    <View style={[s.newBadge, { backgroundColor: selected.color + '33', borderWidth: 1, borderColor: selected.color }]}>
                      <Text style={[s.newBadgeText, { color: selected.color }]}>{selected.badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={[s.heroTagline, { color: colors.tabBarInactive }]}>{selected.tagline}</Text>
              </View>
            </View>
            <View style={s.heroBadges}>
              <View style={[s.riskBadge, { backgroundColor: selected.riskColor + '22' }]}>
                <Text style={[s.riskText, { color: selected.riskColor }]}>{selected.risk} Risk</Text>
              </View>
              <View style={[s.riskBadge, { backgroundColor: selected.entryMode === 'RETEST' ? '#06B6D422' : colors.card }]}>
                <Ionicons
                  name={selected.entryMode === 'RETEST' ? 'return-down-back-outline' : 'flash-outline'}
                  size={12}
                  color={selected.entryMode === 'RETEST' ? '#06B6D4' : colors.tabBarInactive}
                />
                <Text style={[s.riskText, { color: selected.entryMode === 'RETEST' ? '#06B6D4' : colors.tabBarInactive }]}>
                  {selected.entryMode === 'RETEST' ? 'Retest Entry' : 'Breakout Entry'}
                </Text>
              </View>
            </View>
          </View>

          {/* Concept */}
          <SectionHeader title="Strategy Concept" colors={colors} />
          <Text style={[s.conceptText, { color: colors.text }]}>{selected.concept}</Text>

          {/* Key numbers — skip for Custom */}
          {selected.key !== 'CUSTOM' && (
            <>
              <SectionHeader title="Key Parameters" colors={colors} />
              <View style={[s.metricsGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <MetricCell label="Contracts" value={String(selected.contracts)} color={selected.color} />
                <MetricCell label="Stop" value={`${selected.stop}%`} color="#EF4444" />
                <MetricCell label="TP1" value={`+${selected.tp1}%`} color="#22C55E" />
                <MetricCell label="TP2" value={`+${selected.tp2}%`} color="#22C55E" />
                <MetricCell label="Close@TP1" value={`${selected.tp1Close}%`} color={colors.tabBarInactive} />
                <MetricCell label="Close@TP2" value={`${selected.tp2Close}%`} color={colors.tabBarInactive} />
                {selected.runnerPct > 0
                  ? <MetricCell label="Runner" value={`${selected.runnerPct}%`} color="#A855F7" />
                  : <MetricCell label="Runner" value="None" color={colors.tabBarInactive} />
                }
                <MetricCell label="VIX Max" value={String(selected.vixMax)} color={colors.tabBarInactive} />
                <MetricCell label="Window" value={`${selected.window}m`} color={colors.tabBarInactive} />
              </View>
            </>
          )}

          {/* Retest explainer — only for RETESTER */}
          {selected.entryMode === 'RETEST' && (
            <>
              <SectionHeader title="How Retest Entry Works" colors={colors} />
              <View style={[s.retestCard, { backgroundColor: '#06B6D40D', borderColor: '#06B6D433' }]}>
                <RetestStep step={1} text="OrbService confirms a 3-min breakout above ORH (or below ORL)" color="#06B6D4" colors={colors} />
                <RetestStep step={2} text="Engine does NOT enter. Sets a watch for price to pull back to that level" color="#06B6D4" colors={colors} />
                <RetestStep step={3} text="If price returns within 0.12% of ORH and holds → enter here" color="#06B6D4" colors={colors} />
                <RetestStep step={4} text="If price drops through ORH (or rises through ORL) → breakout invalidated, no trade" color="#EF4444" colors={colors} />
                <RetestStep step={5} text="If no retest occurs within 60 min → window expires, session skipped" color={colors.tabBarInactive} colors={colors} />
              </View>
            </>
          )}

          {/* Pros / Cons */}
          <SectionHeader title="Pros & Cons" colors={colors} />
          <View style={s.prosConsRow}>
            <View style={[s.prosBox, { backgroundColor: '#22C55E0D', borderColor: '#22C55E33' }]}>
              <Text style={[s.prosConsHeader, { color: '#22C55E' }]}>Pros</Text>
              {selected.pros.map((p, i) => (
                <View key={i} style={s.bulletRow}>
                  <Ionicons name="checkmark-circle" size={13} color="#22C55E" style={{ marginTop: 2 }} />
                  <Text style={[s.bulletText, { color: colors.text }]}>{p}</Text>
                </View>
              ))}
            </View>
            <View style={[s.consBox, { backgroundColor: '#EF44440D', borderColor: '#EF444433' }]}>
              <Text style={[s.prosConsHeader, { color: '#EF4444' }]}>Cons</Text>
              {selected.cons.map((c, i) => (
                <View key={i} style={s.bulletRow}>
                  <Ionicons name="close-circle" size={13} color="#EF4444" style={{ marginTop: 2 }} />
                  <Text style={[s.bulletText, { color: colors.text }]}>{c}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Best for / Avoid */}
          <SectionHeader title="When to Use" colors={colors} />
          <View style={[s.useCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.useRow}>
              <Ionicons name="thumbs-up-outline" size={16} color="#22C55E" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[s.useLabel, { color: colors.tabBarInactive }]}>BEST FOR</Text>
                <Text style={[s.useText, { color: colors.text }]}>{selected.bestFor}</Text>
              </View>
            </View>
            <View style={[s.useDivider, { backgroundColor: colors.border }]} />
            <View style={s.useRow}>
              <Ionicons name="thumbs-down-outline" size={16} color="#EF4444" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[s.useLabel, { color: colors.tabBarInactive }]}>AVOID</Text>
                <Text style={[s.useText, { color: colors.text }]}>{selected.avoid}</Text>
              </View>
            </View>
          </View>

          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

const SectionHeader = ({ title, colors }: { title: string; colors: any }) => (
  <Text style={[s.sectionHeader, { color: colors.tabBarInactive }]}>{title.toUpperCase()}</Text>
);

const MetricCell = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <View style={s.metricCell}>
    <Text style={[s.metricValue, { color }]}>{value}</Text>
    <Text style={s.metricLabel}>{label}</Text>
  </View>
);

const RetestStep = ({ step, text, color, colors }: { step: number; text: string; color: string; colors: any }) => (
  <View style={s.retestRow}>
    <View style={[s.retestNum, { backgroundColor: color + '22', borderColor: color + '55' }]}>
      <Text style={[s.retestNumText, { color }]}>{step}</Text>
    </View>
    <Text style={[s.retestText, { color: colors.text }]}>{text}</Text>
  </View>
);

// ── Styles ──────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:       { flex: 1 },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle:     { fontSize: 18, fontWeight: '700' },

  selectorRow:     { borderBottomWidth: StyleSheet.hairlineWidth, maxHeight: 68 },
  selectorContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  selectorChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  selectorEmoji:   { fontSize: 16 },
  selectorLabel:   { fontSize: 13, fontWeight: '600' },

  detail:          { paddingHorizontal: 16, paddingTop: 12, gap: 6 },

  hero:            { borderLeftWidth: 3, borderRadius: 12, padding: 14, marginBottom: 6 },
  heroTop:         { flexDirection: 'row', gap: 12, marginBottom: 10 },
  heroEmoji:       { fontSize: 36 },
  heroNameRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  heroName:        { fontSize: 20, fontWeight: '800' },
  heroTagline:     { fontSize: 13, marginTop: 3, lineHeight: 18 },
  heroBadges:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  riskBadge:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  riskText:        { fontSize: 12, fontWeight: '600' },
  newBadge:        { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  newBadgeText:    { fontSize: 10, fontWeight: '800', color: '#fff' },

  sectionHeader:   { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },
  conceptText:     { fontSize: 14, lineHeight: 21 },

  metricsGrid:     { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, borderWidth: 1, padding: 8 },
  metricCell:      { width: '33.3%', alignItems: 'center', paddingVertical: 10 },
  metricValue:     { fontSize: 16, fontWeight: '800' },
  metricLabel:     { fontSize: 10, color: '#888', marginTop: 2, fontWeight: '600' },

  retestCard:      { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  retestRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  retestNum:       { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  retestNumText:   { fontSize: 11, fontWeight: '800' },
  retestText:      { fontSize: 13, lineHeight: 19, flex: 1 },

  prosConsRow:     { flexDirection: 'row', gap: 10 },
  prosBox:         { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  consBox:         { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  prosConsHeader:  { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 2 },
  bulletRow:       { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  bulletText:      { fontSize: 12, lineHeight: 17, flex: 1 },

  useCard:         { borderRadius: 12, borderWidth: 1, padding: 14, gap: 0 },
  useRow:          { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10 },
  useDivider:      { height: StyleSheet.hairlineWidth },
  useLabel:        { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 3 },
  useText:         { fontSize: 13, lineHeight: 19 },
});
