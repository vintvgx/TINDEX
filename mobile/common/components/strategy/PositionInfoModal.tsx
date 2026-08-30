import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatContractSymbolShort } from '@/lib/formatContract';
import { PROFILES } from '@/common/components/strategy/ProfileGuideModal';
import { RUNNER_MODE_LABEL } from '@/common/utils/strategy/runnerModeLabel';
import type { ProfileKey } from '@/common/types/strategy';

export interface PositionInfoData {
  ticker: string;
  direction?: 'CALL' | 'PUT';
  contract?: string;
  paperMode?: boolean;
  isSwing?: boolean;
  entry_premium: number;
  mid_price: number;
  qty_remaining: number;
  pnl: number;
  pnl_pct: number;
  hard_stop: number;
  tp1: number;
  tp2?: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  showTp2?: boolean;
  slEnabled?: boolean;
  tpEnabled?: boolean;
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
  runner_mode?: 'trail' | 'be_hold' | 'none';
  runner_trail?: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: any;
  profile?: ProfileKey;
  data: PositionInfoData;
}

/**
 * Single "everything about this position" modal — replaces the header's
 * always-visible profile badge and reduces the card's badge clutter (SWING/
 * NO SL/NO TP) down to a compact inline flag row; anything more than a
 * glance goes here instead, one ⓘ tap away. Renders the profile's guide
 * content (from PROFILES, the same data ProfileGuideModal reads) INLINE
 * rather than opening a second native Modal — RN only reliably presents one
 * Modal at a time, so nesting a second on top of this one isn't an option.
 */
export function PositionInfoModal({ visible, onClose, colors, profile, data }: Props) {
  const guide = profile ? PROFILES.find((p) => p.key === profile) : undefined;
  const accentColor = data.direction === 'PUT' ? colors.error : colors.success;
  const pnlColor = data.pnl >= 0 ? colors.success : colors.error;
  const slEnabled = data.slEnabled !== false;
  const tpEnabled = data.tpEnabled !== false;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: colors.text }]}>{data.ticker} Position</Text>
            {!!data.contract && (
              <Text style={[s.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {formatContractSymbolShort(data.contract)}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={[s.closeBtn, { backgroundColor: colors.surface ?? colors.card, borderColor: colors.border }]}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {/* Flags */}
          <View style={s.flagRow}>
            {!!data.direction && (
              <Flag label={data.direction} color={accentColor} colors={colors} />
            )}
            {data.paperMode && <Flag label="PAPER" color="#FF9F0A" colors={colors} />}
            {data.isSwing && <Flag label="SWING" color="#A855F7" colors={colors} />}
            {!slEnabled && <Flag label="NO SL" color={colors.error} colors={colors} />}
            {!tpEnabled && <Flag label="NO TP" color="#FF9F0A" colors={colors} />}
          </View>

          {/* P&L */}
          <View style={[s.pnlCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.pnlValue, { color: pnlColor }]}>
              {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
            </Text>
            <Text style={[s.pnlPct, { color: pnlColor }]}>
              {data.pnl_pct >= 0 ? '+' : ''}{data.pnl_pct.toFixed(1)}%
            </Text>
          </View>

          {/* Position stats */}
          <SectionLabel colors={colors}>POSITION</SectionLabel>
          <View style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <StatRow label="Entry" value={`$${data.entry_premium.toFixed(2)}`} colors={colors} />
            <StatRow label="Current" value={`$${data.mid_price.toFixed(2)}`} colors={colors} valueColor={colors.text} />
            <StatRow label="Qty Remaining" value={String(data.qty_remaining)} colors={colors} />
            <StatRow
              label="Stop Loss"
              value={slEnabled ? `$${data.hard_stop.toFixed(2)}` : 'Disabled'}
              colors={colors}
              valueColor={slEnabled ? colors.error : colors.textSecondary}
            />
            <StatRow
              label="TP1"
              value={tpEnabled ? `$${data.tp1.toFixed(2)}` : 'Disabled'}
              colors={colors}
              valueColor={tpEnabled ? undefined : colors.textSecondary}
              badge={tpEnabled && data.tp1_hit ? 'Hit' : undefined}
            />
            {data.showTp2 !== false && data.tp2 != null && (
              <StatRow
                label="TP2"
                value={tpEnabled ? `$${data.tp2.toFixed(2)}` : 'Disabled'}
                colors={colors}
                valueColor={tpEnabled ? undefined : colors.textSecondary}
                badge={tpEnabled && data.tp2_hit ? 'Hit' : undefined}
              />
            )}
            {data.runner_mode && (
              <StatRow
                label="Runner"
                value={data.runner_mode === 'trail' && data.runner_trail != null
                  ? `Trail $${data.runner_trail.toFixed(2)}`
                  : RUNNER_MODE_LABEL[data.runner_mode]}
                colors={colors}
              />
            )}
            {slEnabled && data.sl_grace_enabled && data.sl_grace_minutes != null && (
              <StatRow label="Stop Grace" value={`${data.sl_grace_minutes} min`} colors={colors} last />
            )}
          </View>

          {/* Profile */}
          {guide && (
            <>
              <SectionLabel colors={colors}>PROFILE</SectionLabel>
              <View style={[s.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={s.profileHeaderRow}>
                  <Text style={s.profileEmoji}>{guide.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.profileName, { color: colors.text }]}>{guide.name}</Text>
                    <Text style={[s.profileTagline, { color: colors.textSecondary }]}>{guide.tagline}</Text>
                  </View>
                  <View style={[s.riskPill, { backgroundColor: guide.riskColor + '22' }]}>
                    <Text style={[s.riskPillText, { color: guide.riskColor }]}>{guide.risk}</Text>
                  </View>
                </View>
                <Text style={[s.profileConcept, { color: colors.textSecondary }]}>{guide.concept}</Text>
                <View style={[s.profileMetaRow, { borderTopColor: colors.border }]}>
                  <ProfileMeta label="Contracts" value={String(guide.contracts)} colors={colors} />
                  <ProfileMeta label="Stop" value={`${guide.stop}%`} colors={colors} />
                  <ProfileMeta label="TP1" value={`${guide.tp1}%`} colors={colors} />
                  <ProfileMeta label="TP2" value={`${guide.tp2}%`} colors={colors} />
                </View>
                <Text style={[s.profileBestFor, { color: colors.textSecondary }]}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>Best for: </Text>
                  {guide.bestFor}
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Flag({ label, color, colors }: { label: string; color: string; colors: any }) {
  return (
    <View style={[s.flag, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
      <Text style={[s.flagText, { color }]}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children, colors }: { children: React.ReactNode; colors: any }) {
  return (
    <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: 18, marginBottom: 8 }}>
      {children}
    </Text>
  );
}

function StatRow({ label, value, colors, valueColor, badge, last }: {
  label: string; value: string; colors: any; valueColor?: string; badge?: string; last?: boolean;
}) {
  return (
    <View style={[s.statRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text style={[s.statLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={[s.statValue, { color: valueColor ?? colors.text }]}>{value}</Text>
        {badge && (
          <View style={[s.hitBadge, { backgroundColor: colors.success + '22' }]}>
            <Text style={[s.hitBadgeText, { color: colors.success }]}>{badge}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ProfileMeta({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title:     { fontSize: 18, fontWeight: '700' },
  subtitle:  { fontSize: 13, marginTop: 1 },
  closeBtn:  { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  flagRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  flag:      { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7, borderWidth: 1 },
  flagText:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  pnlCard:   { borderRadius: 12, borderWidth: 1, padding: 16, alignItems: 'center', gap: 2 },
  pnlValue:  { fontSize: 26, fontWeight: '800' },
  pnlPct:    { fontSize: 14, fontWeight: '600' },

  statCard:  { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14 },
  statRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11 },
  statLabel: { fontSize: 13 },
  statValue: { fontSize: 14, fontWeight: '600' },
  hitBadge:  { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  hitBadgeText: { fontSize: 10, fontWeight: '700' },

  profileCard:      { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  profileHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  profileEmoji:     { fontSize: 26 },
  profileName:      { fontSize: 15, fontWeight: '700' },
  profileTagline:   { fontSize: 12, marginTop: 2, lineHeight: 16 },
  riskPill:         { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  riskPillText:     { fontSize: 11, fontWeight: '700' },
  profileConcept:   { fontSize: 12.5, lineHeight: 18 },
  profileMetaRow:   { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  profileBestFor:   { fontSize: 12, lineHeight: 17 },
});
