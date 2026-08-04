import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Alert, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StrategyConfig, StrategyProfile } from '@/common/types/strategy';
import { PROFILES as PROFILE_GUIDES } from '@/common/components/strategy/ProfileGuideModal';
import { useUpdateStrategyConfig } from '@/hooks/mutations/strategy/useUpdateStrategyConfig';
import { useToast } from '@/common/components/ui/Toast';
import { RUNNER_MODE_LABEL } from '@/common/utils/strategy/runnerModeLabel';

interface Props {
  visible: boolean;
  config: StrategyConfig | null;
  profiles: StrategyProfile[];
  colors: any;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MODE_COLORS = { paper: '#FF9F0A', live: '#30D158', off: '#FF453A' } as const;
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F'];

export function StrategyDetailModal({ visible, config, profiles, colors, onClose, onEdit, onDelete }: Props) {
  if (!config) return null;

  const guide = PROFILE_GUIDES.find(p => p.key === config.profile) ?? PROFILE_GUIDES.find(p => p.key === 'CUSTOM')!;
  // Effective values for THIS instance — the per-instance override (if the
  // user turned on "Customize This Strategy") wins, otherwise fall back to
  // the base archetype's defaults. Either way this reflects what will
  // actually fire, not just the textbook profile description.
  const thresholds = config.custom_thresholds ?? profiles.find(p => p.key === config.profile)?.thresholds;
  const isCustomized = config.custom_thresholds != null;

  const mode: 'paper' | 'live' | 'off' = !config.active ? 'off' : config.paper_mode ? 'paper' : 'live';
  const modeColor = MODE_COLORS[mode];
  const modeLabel = mode === 'off' ? 'Off' : mode === 'paper' ? 'Paper' : 'Live';

  const hasPosition = config.has_position === true;

  const toast = useToast();
  const updateConfig = useUpdateStrategyConfig();
  const handleToggleActive = (next: boolean) => {
    updateConfig.mutate({ id: config.id, active: next }, {
      onError: () => toast.error('Failed to update strategy'),
    });
  };

  const handleEditPress = () => { onClose(); onEdit(); };

  const handleDeletePress = () => {
    const label = config.strategy_name || `${config.ticker} ${config.profile.replace('_', ' ')}`;
    Alert.alert(
      'Delete Strategy',
      `Remove "${label}"? This will stop the engine and cancel any open positions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { onClose(); onDelete(); } },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <Text style={[s.headerTitle, { color: colors.text }]}>Strategy Details</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.tabBarInactive} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.detail}>
          {/* Hero — same layout as the Profile Guide */}
          <View style={[s.hero, { borderLeftColor: guide.color, backgroundColor: guide.color + '0D' }]}>
            <View style={s.heroTop}>
              <Text style={s.heroEmoji}>{guide.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.heroName, { color: colors.text }]}>
                  {config.ticker} · {guide.name}
                </Text>
                {config.strategy_name ? (
                  <Text style={[s.heroSubName, { color: colors.tabBarInactive }]}>{config.strategy_name}</Text>
                ) : null}
                <Text style={[s.heroTagline, { color: colors.tabBarInactive }]}>{guide.tagline}</Text>
              </View>
            </View>
            <View style={s.heroBadges}>
              <Pill icon="ellipse" iconColor={modeColor} label={modeLabel} color={modeColor} colors={colors} />
              <Pill label={`${guide.risk} Risk`} color={guide.riskColor} colors={colors} />
              <Pill
                icon={config.confirm_entry ? 'hand-left-outline' : 'flash-outline'}
                label={config.confirm_entry ? 'Confirm Entry' : 'Auto Entry'}
                color={config.confirm_entry ? '#30D158' : colors.tabBarInactive}
                colors={colors}
                dim={!config.confirm_entry}
              />
            </View>
          </View>

          {/* Active/Not Active — the one control that lives here rather than
              on the card itself: flipping it PATCHes config.active straight
              away, which already stops the engine from entering new trades
              for this strategy (see orb_engine.py's session_skipped gate) —
              this switch doesn't need to do anything more than that PATCH. */}
          <SectionHeader title="Status" colors={colors} />
          <View style={[s.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.settingRow, { borderBottomWidth: 0 }]}>
              <View>
                <Text style={[s.settingLabel, { color: colors.text, fontWeight: '700' }]}>Active</Text>
                <Text style={[s.statusHint, { color: colors.tabBarInactive }]}>
                  {config.active ? 'Trading normally' : 'Paused — no new trades will be entered'}
                </Text>
              </View>
              <Switch
                value={config.active}
                onValueChange={handleToggleActive}
                disabled={updateConfig.isPending}
                trackColor={{ false: colors.border, true: '#30D15855' }}
                thumbColor={config.active ? '#30D158' : undefined}
              />
            </View>
          </View>

          {/* Instance settings */}
          <SectionHeader title="Settings" colors={colors} />
          <View style={[s.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SettingRow label="Trade Days" value={(config.trade_days ?? []).map(d => DAY_LABELS[d]).join('/') || '—'} colors={colors} />
            <SettingRow label="Capital Limit" value={config.capital_limit != null ? `$${config.capital_limit.toLocaleString()}` : 'Full buying power'} colors={colors} />
            <SettingRow label="Bypass Breakout Window" value={config.bypass_breakout_window ? 'Yes' : 'No'} colors={colors} />
            <SettingRow label="Smart Contracts" value={config.smart_contracts ? 'Enabled' : 'Disabled'} colors={colors} last />
          </View>

          {/* Key Parameters — same MetricCell grid layout as the Profile Guide,
              but sourced from this instance's actual effective values. */}
          {thresholds && (
            <>
              <SectionHeader title="Key Parameters" colors={colors} />
              <View style={[s.metricsGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <MetricCell label="Contracts" value={String(thresholds.qty_contracts)} color={guide.color} />
                <MetricCell label="Stop" value={`${Math.round(thresholds.max_loss_pct * 100)}%`} color="#EF4444" />
                <MetricCell label="TP1" value={`+${Math.round((thresholds.tp1_mult - 1) * 100)}%`} color="#22C55E" />
                <MetricCell label="TP2" value={`+${Math.round((thresholds.tp2_mult - 1) * 100)}%`} color="#22C55E" />
                <MetricCell label="Close@TP1" value={`${Math.round(thresholds.tp1_close_pct * 100)}%`} color={colors.tabBarInactive} />
                <MetricCell label="Close@TP2" value={`${Math.round(thresholds.tp2_close_pct * 100)}%`} color={colors.tabBarInactive} />
                <MetricCell label="Exit Style" value={RUNNER_MODE_LABEL[thresholds.runner_mode ?? 'trail']} color="#A855F7" />
                {/* Only meaningful in trail mode — be_hold/none never move this
                    floor, so showing a trail % for them would be misleading. */}
                {(thresholds.runner_mode ?? 'trail') === 'trail' && (
                  <MetricCell label="Runner Trail" value={`${Math.round(thresholds.runner_trail_pct * 100)}%`} color="#A855F7" />
                )}
                {/* Cascade never applies to a 1-contract entry (see
                    exit_manager.py's qty_remaining > 1 gate) regardless of
                    what cascade_close_pct is configured to. */}
                <MetricCell
                  label="Cascade"
                  value={thresholds.qty_contracts > 1 && (thresholds.cascade_close_pct ?? 0) > 0 ? 'Yes' : 'No'}
                  color={colors.tabBarInactive}
                />
                <MetricCell label="VIX Max" value={String(thresholds.vix_max_override)} color={colors.tabBarInactive} />
                <MetricCell label="Window" value={`${thresholds.breakout_time_limit_min}m`} color={colors.tabBarInactive} />
              </View>
              {isCustomized && (
                <Text style={[s.overrideNote, { color: colors.tabBarInactive }]}>
                  Customized for this strategy — differs from {guide.name}'s defaults.
                </Text>
              )}
            </>
          )}

          {/* Edit / Delete */}
          <SectionHeader title="Manage" colors={colors} />
          {hasPosition ? (
            <Text style={[s.blockedNote, { color: colors.tabBarInactive }]}>
              Close the open position before editing or deleting this strategy.
            </Text>
          ) : (
            <View style={s.actionsRow}>
              <TouchableOpacity
                onPress={handleEditPress}
                activeOpacity={0.8}
                style={[s.actionBtn, { borderColor: colors.accent + '55', backgroundColor: colors.accent + '14' }]}
              >
                <Ionicons name="pencil-outline" size={16} color={colors.accent} />
                <Text style={[s.actionBtnText, { color: colors.accent }]}>Edit Strategy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDeletePress}
                activeOpacity={0.8}
                style={[s.actionBtn, { borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
              >
                <Ionicons name="trash-outline" size={16} color={colors.error} />
                <Text style={[s.actionBtnText, { color: colors.error }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 40 }} />
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

const SettingRow = ({ label, value, colors, last }: { label: string; value: string; colors: any; last?: boolean }) => (
  <View style={[s.settingRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
    <Text style={[s.settingLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[s.settingValue, { color: colors.text }]}>{value}</Text>
  </View>
);

interface PillProps {
  label: string;
  color: string;
  colors: any;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  dim?: boolean;
}

const Pill = ({ label, color, colors, icon, iconColor, dim }: PillProps) => (
  <View style={[s.pill, { backgroundColor: dim ? colors.card : color + '22' }]}>
    {icon && <Ionicons name={icon} size={11} color={iconColor ?? color} />}
    <Text style={[s.pillText, { color }]}>{label}</Text>
  </View>
);

// ── Styles ──────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:      { flex: 1 },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle:    { fontSize: 18, fontWeight: '700' },

  detail:         { paddingHorizontal: 16, paddingTop: 16, gap: 6 },

  hero:           { borderLeftWidth: 3, borderRadius: 12, padding: 14, marginBottom: 6 },
  heroTop:        { flexDirection: 'row', gap: 12, marginBottom: 10 },
  heroEmoji:      { fontSize: 36 },
  heroName:       { fontSize: 20, fontWeight: '800' },
  heroSubName:    { fontSize: 13, fontWeight: '600', marginTop: 2 },
  heroTagline:    { fontSize: 13, marginTop: 3, lineHeight: 18 },
  heroBadges:     { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill:           { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  pillText:       { fontSize: 12, fontWeight: '600' },

  sectionHeader:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },

  settingsCard:   { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  settingRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11 },
  settingLabel:   { fontSize: 13, fontWeight: '500' },
  settingValue:   { fontSize: 13, fontWeight: '700' },
  statusHint:     { fontSize: 11, marginTop: 2, maxWidth: 220 },

  metricsGrid:    { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, borderWidth: 1, padding: 8 },
  metricCell:     { width: '33.3%', alignItems: 'center', paddingVertical: 10 },
  metricValue:    { fontSize: 16, fontWeight: '800' },
  metricLabel:    { fontSize: 10, color: '#888', marginTop: 2, fontWeight: '600' },
  overrideNote:   { fontSize: 11, marginTop: 8, fontStyle: 'italic' },

  blockedNote:    { fontSize: 13, lineHeight: 19 },
  actionsRow:     { flexDirection: 'row', gap: 10 },
  actionBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, paddingVertical: 14 },
  actionBtnText:  { fontSize: 14, fontWeight: '700' },
});
