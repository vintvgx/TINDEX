import React from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { FlowFeed } from '@/common/components/options/FlowFeed';
import type { SwingScore } from '@/common/types/swing';
import { TIER_COLORS } from '@/common/types/swing';

type Tab = 'Overview' | 'Flow';

interface Props {
  item: SwingScore | null;
  visible: boolean;
  onClose: () => void;
  onEnter: (item: SwingScore) => void;
  onWatch: (item: SwingScore) => void;
}

const Row = ({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useThemeColors> }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderColor: colors.border }}>
    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{label}</Text>
    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{value}</Text>
  </View>
);

export function SwingDetailModal({ item, visible, onClose, onEnter, onWatch }: Props) {
  const colors = useThemeColors();
  const [tab, setTab] = React.useState<Tab>('Overview');

  if (!item) return null;

  const tierColor = TIER_COLORS[item.tier] ?? colors.textSecondary;
  const sideColor = item.side === 'call' ? '#10B981' : '#EF4444';
  const dollarFlow = item.dollar_flow >= 1_000_000
    ? `$${(item.dollar_flow / 1_000_000).toFixed(1)}M`
    : `$${(item.dollar_flow / 1_000).toFixed(0)}K`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: colors.border }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Ionicons name="chevron-down" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{item.ticker}</Text>
              <View style={{ backgroundColor: tierColor + '22', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: tierColor, fontSize: 11, fontWeight: '700' }}>{item.tier.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              {item.side.toUpperCase()} ${item.strike} · {item.expiry} · {item.dte}d DTE
            </Text>
          </View>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: '900' }}>
            {item.composite_score.toFixed(0)}
          </Text>
        </View>

        {/* Tab Bar */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border }}>
          {(['Overview', 'Flow'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={{
                flex: 1, paddingVertical: 12, alignItems: 'center',
                borderBottomWidth: 2,
                borderBottomColor: tab === t ? colors.accent : 'transparent',
              }}
            >
              <Text style={{ color: tab === t ? colors.accent : colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'Overview' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {/* Score breakdown */}
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 }}>
              SCORE BREAKDOWN
            </Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <ScoreBar label="Setup Score" value={item.setup_score} color="#3B82F6" colors={colors} />
              <ScoreBar label="Flow Score" value={item.flow_score} color="#10B981" colors={colors} top />
            </View>

            {/* Contract details */}
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 }}>
              CONTRACT
            </Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, marginBottom: 16 }}>
              <Row label="Symbol" value={item.contract_symbol} colors={colors} />
              <Row label="Side" value={item.side.toUpperCase()} colors={colors} />
              <Row label="Strike" value={`$${item.strike}`} colors={colors} />
              <Row label="Expiry" value={item.expiry} colors={colors} />
              <Row label="DTE" value={`${item.dte} days`} colors={colors} />
              <Row label="Premium" value={`$${item.premium?.toFixed(2)}`} colors={colors} />
              <Row label="IV" value={`${item.iv_pct?.toFixed(1)}%`} colors={colors} />
            </View>

            {/* Flow data */}
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8 }}>
              UNUSUAL ACTIVITY
            </Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, marginBottom: 16 }}>
              <Row label="$ Flow" value={dollarFlow} colors={colors} />
              <Row label="Volume" value={item.vol?.toLocaleString()} colors={colors} />
              <Row label="Open Interest" value={item.oi?.toLocaleString()} colors={colors} />
              <Row label="Vol / OI" value={item.vol_oi?.toFixed(2)} colors={colors} />
              <Row label="UW Score" value={item.unusual_score?.toFixed(1)} colors={colors} />
              {item.is_sweep && <Row label="Sweep" value="Yes" colors={colors} />}
              {item.is_floor && <Row label="Floor Block" value="Yes" colors={colors} />}
            </View>

            {/* Actions */}
            <TouchableOpacity
              onPress={() => onEnter(item)}
              style={{ backgroundColor: sideColor, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10 }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                Enter {item.side.toUpperCase()} Position
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onWatch(item)}
              style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Add to Watchlist</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {tab === 'Flow' && (
          <View style={{ flex: 1 }}>
            <FlowFeed ticker={item.ticker} />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function ScoreBar({ label, value, color, colors, top = false }: {
  label: string; value: number; color: string;
  colors: ReturnType<typeof useThemeColors>; top?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <View style={top ? { marginTop: 12 } : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{pct.toFixed(0)} / 100</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3 }}>
        <View style={{ height: 6, width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}
