import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useStrategyConfigs } from '@/hooks/queries/strategy/useStrategyConfigs';
import { useStrategyProfiles } from '@/hooks/queries/strategy/useStrategyProfiles';
import { useAlpacaAccount } from '@/hooks/queries/strategy/useAlpacaAccount';
import { useCreateStrategyConfig } from '@/hooks/mutations/strategy/useCreateStrategyConfig';
import { useUpdateStrategyConfig } from '@/hooks/mutations/strategy/useUpdateStrategyConfig';
import { useDeleteStrategyConfig } from '@/hooks/mutations/strategy/useDeleteStrategyConfig';
import { TradeDaysSelector } from '@/common/components/strategy/TradeDaysSelector';
import { ProfileCard } from '@/common/components/strategy/ProfileCard';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { StrategyConfig, ProfileKey, StrategyProfile } from '@/common/types/strategy';

const TICKERS     = ['SPY', 'QQQ', 'IWM'] as const;
const ORB_MINUTES = [5, 10, 15] as const;

type TradingMode = 'paper' | 'live' | 'off';

const MODE_META: Record<TradingMode, { label: string; icon: string; color: string }> = {
  paper: { label: 'Paper',  icon: 'document-text-outline', color: '#FF9F0A' },
  live:  { label: 'Live',   icon: 'flash-outline',         color: '#30D158' },
  off:   { label: 'Off',    icon: 'power-outline',         color: '#FF453A' },
};

const PROFILE_COLORS: Record<ProfileKey, string> = {
  BULL_DOG:    '#FF6B35',
  THUNDER_CAT: '#4A9EFF',
  WOLF:        '#4CAF84',
};

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F'];

function getMode(config: Pick<StrategyConfig, 'active' | 'paper_mode'>): TradingMode {
  if (!config.active) return 'off';
  return config.paper_mode ? 'paper' : 'live';
}

function modeToConfig(mode: TradingMode): Partial<StrategyConfig> {
  if (mode === 'off')   return { active: false };
  if (mode === 'live')  return { active: true, paper_mode: false };
  return { active: true, paper_mode: true };
}

type FormState = {
  strategy_name: string;
  ticker: typeof TICKERS[number];
  orb_minutes: typeof ORB_MINUTES[number];
  trade_days: number[];
  profile: ProfileKey;
  mode: TradingMode;
  capital_limit: string;  // string for TextInput, parsed to number|null on save
};

const DEFAULT_FORM: FormState = {
  strategy_name: '',
  ticker:        'IWM',
  orb_minutes:   10,
  trade_days:    [0, 2, 4],
  profile:       'THUNDER_CAT',
  mode:          'paper',
  capital_limit: '',
};

function configToForm(cfg: StrategyConfig): FormState {
  return {
    strategy_name: cfg.strategy_name ?? '',
    ticker:        cfg.ticker as any,
    orb_minutes:   cfg.orb_minutes as any,
    trade_days:    cfg.trade_days ?? [0, 2, 4],
    profile:       cfg.profile,
    mode:          getMode(cfg),
    capital_limit: cfg.capital_limit != null ? String(cfg.capital_limit) : '',
  };
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function StrategyScreen() {
  const colors  = useThemeColors();
  const toast   = useToast();

  const { data: configs,  isLoading: configsLoading  } = useStrategyConfigs();
  const { data: profiles, isLoading: profilesLoading } = useStrategyProfiles();
  const { data: account } = useAlpacaAccount(!!(configs && configs.length > 0));

  const { mutate: createConfig } = useCreateStrategyConfig();
  const { mutate: updateConfig } = useUpdateStrategyConfig();
  const { mutate: deleteConfig } = useDeleteStrategyConfig();

  const [modalVisible, setModalVisible]  = useState(false);
  const [editingConfig, setEditingConfig] = useState<StrategyConfig | null>(null);
  const [form, setForm]                  = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving]              = useState(false);

  const openCreate = () => {
    setEditingConfig(null);
    setForm(DEFAULT_FORM);
    setModalVisible(true);
  };

  const openEdit = (cfg: StrategyConfig) => {
    setEditingConfig(cfg);
    setForm(configToForm(cfg));
    setModalVisible(true);
  };

  const handleDelete = (cfg: StrategyConfig) => {
    const label = cfg.strategy_name || `${cfg.ticker} ${cfg.profile.replace('_', ' ')}`;
    Alert.alert(
      'Delete Strategy',
      `Remove "${label}"? This will stop the engine and cancel any open positions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => deleteConfig(cfg.id, {
            onSuccess: () => toast.success('Strategy removed'),
            onError:   () => toast.error('Failed to delete strategy'),
          }),
        },
      ]
    );
  };

  const patchForm = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const handleModeSelect = (newMode: TradingMode) => {
    if (newMode === 'live') {
      Alert.alert(
        'Switch to Live Trading',
        'All future orders will use REAL MONEY.\n\nMake sure you have reviewed your position limits before proceeding.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch to Live', style: 'destructive', onPress: () => patchForm('mode', 'live') },
        ]
      );
    } else {
      patchForm('mode', newMode);
    }
  };

  const handleSave = () => {
    const capitalNum = form.capital_limit.trim() === ''
      ? null
      : parseFloat(form.capital_limit);
    if (form.capital_limit.trim() !== '' && (isNaN(capitalNum!) || capitalNum! <= 0)) {
      toast.error('Capital limit must be a positive number');
      return;
    }
    if (form.trade_days.length === 0) {
      toast.error('Select at least one trade day');
      return;
    }

    const payload = {
      strategy_name: form.strategy_name.trim(),
      ticker:        form.ticker,
      orb_minutes:   form.orb_minutes,
      trade_days:    form.trade_days,
      profile:       form.profile,
      capital_limit: capitalNum,
      ...modeToConfig(form.mode),
    };

    setSaving(true);
    if (editingConfig) {
      updateConfig({ id: editingConfig.id, ...payload }, {
        onSuccess: () => { toast.success('Strategy saved'); setModalVisible(false); },
        onError:   () => toast.error('Failed to save strategy'),
        onSettled: () => setSaving(false),
      });
    } else {
      createConfig(payload as any, {
        onSuccess: () => { toast.success('Strategy added'); setModalVisible(false); },
        onError:   () => toast.error('Failed to create strategy'),
        onSettled: () => setSaving(false),
      });
    }
  };

  if (configsLoading || profilesLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>ORB Strategies</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Account banner */}
        {account && (
          <View style={[styles.accountCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View>
              <Text style={[styles.accountLabel, { color: colors.tabBarInactive }]}>
                {account.paper_mode ? 'PAPER ACCOUNT' : 'LIVE ACCOUNT'}
              </Text>
              <Text style={[styles.accountEquity, { color: colors.text }]}>
                ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={styles.pnlCol}>
              <Text style={[styles.pnlToday, { color: account.pnl_today >= 0 ? colors.success : colors.error }]}>
                {account.pnl_today >= 0 ? '+' : ''}${account.pnl_today.toFixed(2)}
              </Text>
              <Text style={[styles.pnlPctToday, { color: account.pnl_today >= 0 ? colors.success : colors.error }]}>
                {account.pnl_today_pct.toFixed(2)}% today
              </Text>
            </View>
          </View>
        )}

        {/* Strategy list */}
        <SectionHeader title={`Active Strategies (${configs?.length ?? 0})`} colors={colors} />

        {configs && configs.length > 0 ? (
          configs.map(cfg => (
            <StrategyCard
              key={cfg.id}
              config={cfg}
              colors={colors}
              onEdit={() => openEdit(cfg)}
              onDelete={() => handleDelete(cfg)}
            />
          ))
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="bar-chart-outline" size={32} color={colors.tabBarInactive} />
            <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>
              No strategies configured
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.tabBarInactive }]}>
              Tap + to add your first strategy
            </Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={openCreate}
        style={[styles.fab, { backgroundColor: colors.accent }]}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Strategy form modal */}
      <StrategyFormModal
        visible={modalVisible}
        isEditing={!!editingConfig}
        form={form}
        profiles={profiles ?? []}
        saving={saving}
        colors={colors}
        onClose={() => setModalVisible(false)}
        onPatch={patchForm}
        onModeSelect={handleModeSelect}
        onSave={handleSave}
      />
    </SafeAreaView>
  );
}

// ── StrategyCard ───────────────────────────────────────────────────────────────

interface StrategyCardProps {
  config: StrategyConfig;
  colors: any;
  onEdit: () => void;
  onDelete: () => void;
}

function StrategyCard({ config, colors, onEdit, onDelete }: StrategyCardProps) {
  const mode         = getMode(config);
  const modeMeta     = MODE_META[mode];
  const profileColor = PROFILE_COLORS[config.profile] ?? colors.accent;
  const activeDays   = config.trade_days ?? [];

  const { data: live, connected: streaming } = useStrategyLivePrice(
    config.id,
    config.has_position === true,
  );

  const pnlColor = live
    ? (live.pnl >= 0 ? colors.success : colors.error)
    : colors.tabBarInactive;

  return (
    <View style={[styles.stratCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Left accent bar */}
      <View style={[styles.stratAccent, { backgroundColor: profileColor }]} />

      <View style={styles.stratBody}>
        {/* Row 1: title + mode badge */}
        <View style={styles.stratRow}>
          <View style={styles.stratTitleGroup}>
            <Text style={[styles.stratTicker, { color: colors.text }]}>{config.ticker}</Text>
            {config.strategy_name ? (
              <Text style={[styles.stratName, { color: colors.tabBarInactive }]}>
                {config.strategy_name}
              </Text>
            ) : null}
          </View>
          <View style={[styles.modeBadge, { backgroundColor: modeMeta.color + '22' }]}>
            <View style={[styles.modeDot, { backgroundColor: modeMeta.color }]} />
            <Text style={[styles.modeBadgeText, { color: modeMeta.color }]}>{modeMeta.label}</Text>
          </View>
        </View>

        {/* Row 2: profile + orb window + days */}
        <View style={styles.stratMeta}>
          <MetaChip label={config.profile.replace('_', ' ')} color={profileColor} />
          <MetaChip label={`ORB ${config.orb_minutes}m`} color={colors.accent} />
          <MetaChip
            label={activeDays.map(d => DAY_LABELS[d]).join('/')}
            color={colors.tabBarInactive}
          />
        </View>

        {/* Row 3: capital limit */}
        {config.capital_limit != null && (
          <Text style={[styles.stratCapital, { color: colors.tabBarInactive }]}>
            Capital: ${config.capital_limit.toLocaleString()}
          </Text>
        )}

        {/* Live position panel */}
        {config.has_position && (
          <View style={[styles.livePnlCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {/* Stream indicator */}
            <View style={styles.liveHeader}>
              <View style={[styles.modeDot, {
                backgroundColor: streaming ? colors.success : colors.tabBarInactive,
              }]} />
              <Text style={[styles.liveLabel, { color: colors.tabBarInactive }]}>
                {streaming ? 'LIVE' : 'CONNECTING'}
              </Text>
              {live && (
                <Text style={[styles.liveContract, { color: colors.tabBarInactive }]}>
                  {live.contract}
                </Text>
              )}
            </View>

            {live ? (
              <View style={styles.liveStats}>
                {/* Option price */}
                <View style={styles.liveStat}>
                  <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Price</Text>
                  <Text style={[styles.liveStatValue, { color: colors.text }]}>
                    ${live.mid_price.toFixed(2)}
                  </Text>
                </View>
                {/* P&L */}
                <View style={styles.liveStat}>
                  <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>P&L</Text>
                  <Text style={[styles.liveStatValue, { color: pnlColor }]}>
                    {live.pnl >= 0 ? '+' : ''}${live.pnl.toFixed(2)}
                  </Text>
                </View>
                {/* P&L % */}
                <View style={styles.liveStat}>
                  <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Chg</Text>
                  <Text style={[styles.liveStatValue, { color: pnlColor }]}>
                    {live.pnl_pct >= 0 ? '+' : ''}{live.pnl_pct.toFixed(1)}%
                  </Text>
                </View>
                {/* Qty remaining */}
                <View style={styles.liveStat}>
                  <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Qty</Text>
                  <Text style={[styles.liveStatValue, { color: colors.text }]}>
                    {live.qty_remaining}
                  </Text>
                </View>
              </View>
            ) : (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
            )}

            {/* TP hit badges */}
            {live && (live.tp1_hit || live.tp2_hit) && (
              <View style={styles.tpRow}>
                {live.tp1_hit && (
                  <View style={[styles.tpBadge, { backgroundColor: colors.success + '22' }]}>
                    <Text style={[styles.tpBadgeText, { color: colors.success }]}>TP1 ✓</Text>
                  </View>
                )}
                {live.tp2_hit && (
                  <View style={[styles.tpBadge, { backgroundColor: colors.success + '22' }]}>
                    <Text style={[styles.tpBadgeText, { color: colors.success }]}>TP2 ✓</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.stratActions}>
        <TouchableOpacity onPress={onEdit} hitSlop={8} style={styles.actionBtn}>
          <Ionicons name="pencil-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} hitSlop={8} style={styles.actionBtn}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const MetaChip = ({ label, color }: { label: string; color: string }) => (
  <View style={[styles.metaChip, { borderColor: color + '55', backgroundColor: color + '11' }]}>
    <Text style={[styles.metaChipText, { color }]}>{label}</Text>
  </View>
);

// ── StrategyFormModal ──────────────────────────────────────────────────────────

interface FormModalProps {
  visible: boolean;
  isEditing: boolean;
  form: FormState;
  profiles: StrategyProfile[];
  saving: boolean;
  colors: any;
  onClose: () => void;
  onPatch: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  onModeSelect: (mode: TradingMode) => void;
  onSave: () => void;
}

function StrategyFormModal({
  visible, isEditing, form, profiles, saving, colors,
  onClose, onPatch, onModeSelect, onSave,
}: FormModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.modalContainer, { backgroundColor: colors.background }]}
      >
        {/* Modal header */}
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={[styles.modalCancel, { color: colors.accent }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {isEditing ? 'Edit Strategy' : 'New Strategy'}
          </Text>
          <TouchableOpacity onPress={onSave} disabled={saving} hitSlop={12}>
            {saving
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Text style={[styles.modalSave, { color: colors.accent }]}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Strategy name */}
          <SectionHeader title="Strategy Name" colors={colors} />
          <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              value={form.strategy_name}
              onChangeText={v => onPatch('strategy_name', v)}
              placeholder="e.g. IWM Bull Dog M/W/F"
              placeholderTextColor={colors.tabBarInactive}
              style={[styles.textInput, { color: colors.text }]}
              returnKeyType="done"
            />
          </View>

          {/* Trading mode */}
          <SectionHeader title="Trading Mode" colors={colors} />
          <View style={[styles.modeBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {(Object.entries(MODE_META) as [TradingMode, typeof MODE_META[TradingMode]][]).map(([mode, meta]) => {
              const active = form.mode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => onModeSelect(mode)}
                  activeOpacity={0.7}
                  style={[
                    styles.modeBtn,
                    active && { backgroundColor: meta.color + '1A', borderRadius: 10 },
                  ]}
                >
                  <Ionicons name={meta.icon as any} size={18} color={active ? meta.color : colors.tabBarInactive} />
                  <Text style={[styles.modeBtnText, { color: active ? meta.color : colors.tabBarInactive, fontWeight: active ? '700' : '500' }]}>
                    {meta.label}
                  </Text>
                  {active && <View style={[styles.modeDot, { backgroundColor: meta.color }]} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Configuration */}
          <SectionHeader title="Configuration" colors={colors} />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Ticker */}
            <ConfigRow label="Ticker" colors={colors}>
              <View style={styles.chipRow}>
                {TICKERS.map(t => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => onPatch('ticker', t)}
                    style={[
                      styles.chip,
                      { backgroundColor: form.ticker === t ? colors.accent : colors.border,
                        borderColor: form.ticker === t ? colors.accent : colors.border },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: form.ticker === t ? '#fff' : colors.text }]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ConfigRow>

            {/* ORB window */}
            <ConfigRow label="ORB Window" colors={colors}>
              <View style={styles.chipRow}>
                {ORB_MINUTES.map(m => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => onPatch('orb_minutes', m)}
                    style={[
                      styles.chip,
                      { backgroundColor: form.orb_minutes === m ? colors.accent : colors.border,
                        borderColor: form.orb_minutes === m ? colors.accent : colors.border },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: form.orb_minutes === m ? '#fff' : colors.text }]}>
                      {m}m
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ConfigRow>

            {/* Trade days */}
            <ConfigRow label="Trade Days" colors={colors} last>
              <TradeDaysSelector
                selected={form.trade_days}
                onChange={days => onPatch('trade_days', days)}
              />
            </ConfigRow>
          </View>

          {/* Capital limit */}
          <SectionHeader title="Capital Limit" colors={colors} />
          <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.capitalRow}>
              <Text style={[styles.capitalDollar, { color: colors.tabBarInactive }]}>$</Text>
              <TextInput
                value={form.capital_limit}
                onChangeText={v => onPatch('capital_limit', v.replace(/[^0-9.]/g, ''))}
                placeholder="No limit (use full buying power)"
                placeholderTextColor={colors.tabBarInactive}
                keyboardType="decimal-pad"
                style={[styles.capitalInput, { color: colors.text }]}
                returnKeyType="done"
              />
            </View>
          </View>
          <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
            Leave blank to use your full available buying power for this strategy.
          </Text>

          {/* Profile picker */}
          <SectionHeader title="Trading Profile" colors={colors} />
          {profiles.map(p => (
            <ProfileCard
              key={p.key}
              profile={p}
              selected={form.profile === p.key}
              onSelect={key => onPatch('profile', key)}
            />
          ))}

          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

const SectionHeader = ({ title, colors }: { title: string; colors: any }) => (
  <Text style={[styles.sectionHeader, { color: colors.tabBarInactive }]}>{title}</Text>
);

const ConfigRow = ({ label, colors, children, last }: any) => (
  <View style={[
    styles.configRow,
    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  ]}>
    <Text style={[styles.configLabel, { color: colors.text }]}>{label}</Text>
    {children}
  </View>
);

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 8 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  title:     { fontSize: 20, fontWeight: '700' },

  accountCard:   { flexDirection: 'row', justifyContent: 'space-between', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  accountLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  accountEquity: { fontSize: 22, fontWeight: '700' },
  pnlCol:        { alignItems: 'flex-end', justifyContent: 'center' },
  pnlToday:      { fontSize: 16, fontWeight: '700' },
  pnlPctToday:   { fontSize: 12, fontWeight: '500', marginTop: 2 },

  sectionHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 16, marginBottom: 8, color: '#888' },

  // ── Strategy card ──
  stratCard: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  stratAccent: { width: 4 },
  stratBody:   { flex: 1, padding: 12 },
  stratRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  stratTitleGroup: { flex: 1 },
  stratTicker: { fontSize: 18, fontWeight: '700' },
  stratName:   { fontSize: 12, marginTop: 1 },
  stratMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  stratCapital:{ fontSize: 12, marginTop: 4 },

  modeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  modeBadgeText: { fontSize: 11, fontWeight: '600' },
  modeDot:       { width: 6, height: 6, borderRadius: 3 },

  metaChip:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  metaChipText: { fontSize: 11, fontWeight: '600' },

  positionBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  positionText:  { fontSize: 11, fontWeight: '600' },

  livePnlCard:    { marginTop: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  liveHeader:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  liveLabel:      { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  liveContract:   { fontSize: 10, flex: 1, textAlign: 'right' },
  liveStats:      { flexDirection: 'row', justifyContent: 'space-between' },
  liveStat:       { alignItems: 'center', flex: 1 },
  liveStatLabel:  { fontSize: 10, marginBottom: 2 },
  liveStatValue:  { fontSize: 14, fontWeight: '700' },
  tpRow:          { flexDirection: 'row', gap: 6, marginTop: 8 },
  tpBadge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tpBadgeText:    { fontSize: 11, fontWeight: '700' },

  stratActions: { justifyContent: 'center', gap: 12, paddingHorizontal: 10 },
  actionBtn:    { padding: 4 },

  emptyCard:    { alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 32, gap: 8, marginBottom: 12 },
  emptyText:    { fontSize: 15, fontWeight: '600' },
  emptySubtext: { fontSize: 13 },

  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },

  // ── Modal ──
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle:  { fontSize: 17, fontWeight: '600' },
  modalCancel: { fontSize: 15 },
  modalSave:   { fontSize: 15, fontWeight: '700' },
  modalContent:{ paddingHorizontal: 16, paddingTop: 8 },

  inputCard: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 4 },
  textInput: { fontSize: 15, paddingVertical: 12 },

  capitalRow:   { flexDirection: 'row', alignItems: 'center' },
  capitalDollar:{ fontSize: 15, marginRight: 4 },
  capitalInput: { flex: 1, fontSize: 15, paddingVertical: 12 },
  hint:         { fontSize: 12, marginBottom: 4, marginTop: 2, marginHorizontal: 2 },

  modeBar: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 6, marginBottom: 8 },
  modeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 4, position: 'relative' },
  modeBtnText: { fontSize: 12 },

  card:       { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  configRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  configLabel:{ fontSize: 14, fontWeight: '500' },
  chipRow:    { flexDirection: 'row', gap: 6 },
  chip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  chipText:   { fontSize: 13, fontWeight: '600' },
});
