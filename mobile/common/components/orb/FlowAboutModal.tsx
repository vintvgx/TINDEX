import React from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  ScrollView, SafeAreaView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface SectionProps {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useThemeColors>;
}

function Section({ title, icon, iconColor, children, colors }: SectionProps) {
  return (
    <View style={[s.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={s.sectionHeader}>
        <View style={[s.iconBox, { backgroundColor: iconColor + '22' }]}>
          <Text style={{ fontSize: 16 }}>{icon}</Text>
        </View>
        <Text style={[s.sectionTitle, { color: colors.text }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ label, value, valueColor, colors }: {
  label: string; value: string; valueColor?: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={[s.row, { borderTopColor: colors.border }]}>
      <Text style={[s.rowLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[s.rowValue, { color: valueColor ?? colors.text }]}>{value}</Text>
    </View>
  );
}

function Body({ text, colors }: { text: string; colors: ReturnType<typeof useThemeColors> }) {
  return <Text style={[s.body, { color: colors.textSecondary }]}>{text}</Text>;
}

export function FlowAboutModal({ visible, onClose }: Props) {
  const colors = useThemeColors();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[s.header, { borderColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[s.headerTitle, { color: colors.text }]}>Reading the Flow</Text>
            <Text style={[s.headerSub, { color: colors.textTertiary }]}>How to interpret options order flow</Text>
          </View>
          <View style={[s.sourcePill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '700' }}>via UW</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* What is Flow */}
          <Section title="What is Flow?" icon="⚡" iconColor="#F59E0B" colors={colors}>
            <Body
              colors={colors}
              text="Options order flow is the real-time stream of large and unusual options trades hitting the market. ALETHIA pulls this from Unusual Whales (UW), which monitors every options print and flags trades that stand out by size, aggression, or structure."
            />
            <Body
              colors={colors}
              text="Institutions, hedge funds, and informed traders leave footprints in the options market before a move. Flow lets you see which direction they're leaning on a specific ticker — before the price confirms."
            />
          </Section>

          {/* Call % vs Put % */}
          <Section title="Call % vs Put %" icon="📊" iconColor="#3B82F6" colors={colors}>
            <Body
              colors={colors}
              text="The percentages show the directional split of flagged flow for this ticker today."
            />
            <Row label="▲ CALL %" value="Bullish bias — more flagged call volume than puts" valueColor="#10B981" colors={colors} />
            <Row label="▼ PUT %" value="Bearish bias — more flagged put volume than calls" valueColor="#EF4444" colors={colors} />
            <Body
              colors={colors}
              text="A reading above 65% in either direction is considered a strong lean. Mixed flow (50/50) means smart money is hedging or positioning in both directions."
            />
          </Section>

          {/* UW Score */}
          <Section title="UW Score" icon="🎯" iconColor="#8B5CF6" colors={colors}>
            <Body
              colors={colors}
              text="Unusual Whales scores each trade from 0–100 based on how unusual it is relative to normal activity for that ticker."
            />
            <Row label="0 – 50" value="Routine activity, likely noise" colors={colors} />
            <Row label="51 – 70" value="Elevated — worth noting" valueColor="#F59E0B" colors={colors} />
            <Row label="71 – 100" value="Highly unusual — flagged on the card" valueColor="#8B5CF6" colors={colors} />
            <Body
              colors={colors}
              text="The card highlights the top UW score in the flow when it exceeds 70. A single high-score print can outweigh many low-score prints."
            />
          </Section>

          {/* Sweeps vs Floor */}
          <Section title="Sweeps vs Floor Trades" icon="🏛" iconColor="#F97316" colors={colors}>
            <Row label="SWEEP" value="Aggressive market order across multiple exchanges simultaneously" colors={colors} />
            <Row label="FLOOR" value="Large block trade executed on the exchange floor, often institutional" colors={colors} />
            <Body
              colors={colors}
              text="Sweeps signal urgency — the buyer didn't care about price, they just wanted to get filled fast. This often means they expect an imminent move. Floor trades are usually larger, slower, and indicate longer-term positioning."
            />
          </Section>

          {/* In ORB context */}
          <Section title="Flow in ORB Context" icon="🎯" iconColor="#10B981" colors={colors}>
            <Body
              colors={colors}
              text="Flow is most actionable when it aligns with the ORB breakout direction:"
            />
            <Row label="Bullish flow + price above ORH" value="Confirms breakout — strong setup for calls" valueColor="#10B981" colors={colors} />
            <Row label="Bearish flow + price below ORL" value="Confirms breakdown — strong setup for puts" valueColor="#EF4444" colors={colors} />
            <Row label="Flow opposes breakout direction" value="Caution — potential fade or reversal" valueColor="#F59E0B" colors={colors} />
            <Body
              colors={colors}
              text="Flow that runs contrary to the price action is a red flag. Institutional traders are sometimes early, but when flow diverges from the ORB direction, tighten stops."
            />
          </Section>

          {/* Caveats */}
          <Section title="Caveats" icon="⚠️" iconColor="#EF4444" colors={colors}>
            <Body
              colors={colors}
              text="Flow is a probabilistic signal, not a guarantee. Large players hedge positions, take the other side of retail, and occasionally make wrong bets. Treat flow as one confirming factor alongside ORB levels, VWAP, and trend context — not a standalone trade trigger."
            />
          </Section>

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle:  { fontSize: 17, fontWeight: '700' },
  headerSub:    { fontSize: 12, marginTop: 1 },
  sourcePill:   { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  scroll:       { padding: 16 },
  section:      { borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1 },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  iconBox:      { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  body:         { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  row:          { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 6, gap: 8 },
  rowLabel:     { fontSize: 12, fontWeight: '600', width: 100 },
  rowValue:     { fontSize: 12, flex: 1, lineHeight: 18 },
});
