import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform, Switch, UIManager, LayoutAnimation,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useStrategyConfigs } from '@/hooks/queries/strategy/useStrategyConfigs';
import { useQueryClient } from '@tanstack/react-query';
import { useStrategyProfiles } from '@/hooks/queries/strategy/useStrategyProfiles';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useCreateStrategyConfig } from '@/hooks/mutations/strategy/useCreateStrategyConfig';
import { useUpdateStrategyConfig } from '@/hooks/mutations/strategy/useUpdateStrategyConfig';
import { useDeleteStrategyConfig } from '@/hooks/mutations/strategy/useDeleteStrategyConfig';
import { TradeDaysSelector } from '@/common/components/strategy/TradeDaysSelector';
import { ProfileCard } from '@/common/components/strategy/ProfileCard';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { useORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { CustomThresholdsEditor, DEFAULT_CUSTOM_THRESHOLDS } from '@/common/components/strategy/CustomThresholdsEditor';
import { SimulationModal } from '@/common/components/strategy/SimulationModal';
import { ProfileGuideModal } from '@/common/components/strategy/ProfileGuideModal';
import { ImmediateTradePanel } from '@/common/components/strategy/ImmediateTradePanel';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
import type { StrategyConfig, ProfileKey, StrategyProfile, CustomThresholds, OtmFibLevel, ImmediatePosition, LiveOptionPrice, ExitOverrides } from '@/common/types/strategy';
import { formatContractSymbolShort } from '@/lib/formatContract';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Fallback tickers shown when no orb_monitoring_state rows are available yet.
const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];

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
  TREND_RIDER: '#A855F7',
  RETESTER:    '#06B6D4',
  REVERSAL:    '#FF453A',
  CUSTOM:      '#A855F7',
};

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F'];

function getMode(config: Pick<StrategyConfig, 'active' | 'paper_mode'>): TradingMode {
  if (!config.active) return 'off';
  return config.paper_mode ? 'paper' : 'live';
}

function modeToConfig(mode: TradingMode): Partial<StrategyConfig> {
  if (mode === 'off')  return { active: false, paper_mode: false };
  if (mode === 'live') return { active: true, paper_mode: false };
  return { active: true, paper_mode: true };
}

type FormState = {
  strategy_name:          string;
  ticker:                 string;
  trade_days:             number[];
  profile:                ProfileKey;
  mode:                   TradingMode;
  capital_limit:          string;
  bypass_breakout_window: boolean;
  custom_thresholds:      CustomThresholds;
  budget_otm_mode:        boolean;
  otm_fib_level:          OtmFibLevel;
  smart_contracts:        boolean;
  consol_exit:            boolean;
  volume_exit:            boolean;
};

const DEFAULT_FORM: FormState = {
  strategy_name:          '',
  ticker:                 'IWM',
  trade_days:             [0, 2, 4],
  profile:                'TREND_RIDER',
  mode:                   'paper',
  capital_limit:          '',
  bypass_breakout_window: false,
  custom_thresholds:      DEFAULT_CUSTOM_THRESHOLDS,
  budget_otm_mode:        false,
  otm_fib_level:          '1.0',
  smart_contracts:        false,
  consol_exit:            false,
  volume_exit:            false,
};

function configToForm(cfg: StrategyConfig): FormState {
  return {
    strategy_name:          cfg.strategy_name ?? '',
    ticker:                 cfg.ticker,
    trade_days:             cfg.trade_days ?? [0, 2, 4],
    profile:                cfg.profile,
    mode:                   getMode(cfg),
    capital_limit:          cfg.capital_limit != null ? String(cfg.capital_limit) : '',
    bypass_breakout_window: cfg.bypass_breakout_window ?? false,
    custom_thresholds:      cfg.custom_thresholds ?? DEFAULT_CUSTOM_THRESHOLDS,
    budget_otm_mode:        cfg.budget_otm_mode ?? false,
    otm_fib_level:          cfg.otm_fib_level ?? '1.0',
    smart_contracts:        cfg.smart_contracts ?? false,
    consol_exit:            cfg.exit_overrides?.consol_exit ?? false,
    volume_exit:            cfg.exit_overrides?.volume_exit ?? false,
  };
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function StrategyScreen() {
  const colors  = useThemeColors();
  const toast   = useToast();

  const { data: configs,  isLoading: configsLoading  } = useStrategyConfigs();
  const { data: profiles, isLoading: profilesLoading } = useStrategyProfiles();
  const { data: accounts } = useAlpacaBothAccounts(!!(configs && configs.length > 0));
  const { data: monitoringState } = useORBMonitoringState();
  const { data: immediatePositions } = useImmediatePositions();

  // Unique, sorted tickers from orb_monitoring_state — any followed ticker can run
  // a strategy. Falls back to the core ETFs before the state has loaded.
  const tickerOptions = React.useMemo(() => {
    const tickers = (monitoringState ?? [])
      .map(s => s.ticker)
      .filter((t): t is string => !!t);
    const unique = Array.from(new Set(tickers.length ? tickers : FALLBACK_TICKERS));
    return unique.sort();
  }, [monitoringState]);

  const { mutate: createConfig } = useCreateStrategyConfig();
  const { mutate: updateConfig } = useUpdateStrategyConfig();
  const { mutate: deleteConfig } = useDeleteStrategyConfig();

  const [modalVisible, setModalVisible]       = useState(false);
  const [simulationVisible, setSimulationVisible] = useState(false);
  const [editingConfig, setEditingConfig]     = useState<StrategyConfig | null>(null);
  const [form, setForm]                       = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving]                   = useState(false);
  const [guideVisible, setGuideVisible]       = useState(false);

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

    const exitOverrides: ExitOverrides = { consol_exit: form.consol_exit, volume_exit: form.volume_exit };
    const payload = {
      strategy_name:          form.strategy_name.trim(),
      ticker:                 form.ticker,
      trade_days:             form.trade_days,
      profile:                form.profile,
      capital_limit:          capitalNum,
      bypass_breakout_window: form.bypass_breakout_window,
      custom_thresholds:      form.profile === 'CUSTOM' ? form.custom_thresholds : null,
      exit_overrides:         exitOverrides,
      budget_otm_mode:        form.budget_otm_mode,
      otm_fib_level:          form.otm_fib_level,
      smart_contracts:        form.smart_contracts,
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
      <View style={[styles.header, { paddingHorizontal: 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => setGuideVisible(true)}
          hitSlop={8}
          style={[styles.guideBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={0.8}
        >
          <Ionicons name="book-outline" size={17} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>ORB Strategies</Text>
        <TouchableOpacity
          onPress={openCreate}
          hitSlop={8}
          style={[styles.addBtn, { backgroundColor: colors.accent }]}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={20} color={colors.iconButton} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Account banner — paper + live side by side */}
        {accounts && (
          <View style={[styles.accountCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <AccountBannerSide
              label="PAPER"
              accentColor="#FF9F0A"
              account={accounts.paper}
              colors={colors}
            />
            <View style={[styles.accountDivider, { backgroundColor: colors.border }]} />
            <AccountBannerSide
              label="LIVE"
              accentColor={colors.success}
              account={accounts.live}
              colors={colors}
            />
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

        {/* Immediate Trades — open conviction positions (any ticker) */}
        {immediatePositions && immediatePositions.length > 0 && (
          <>
            <SectionHeader title={`Immediate Trades (${immediatePositions.length})`} colors={colors} />
            {immediatePositions.map(pos => (
              <ImmediatePositionCard key={pos.strategy_id} position={pos} colors={colors} />
            ))}
          </>
        )}

        {/* Run Simulation */}
        {configs && configs.length > 0 && (
          <>
            <SectionHeader title="Testing" colors={colors} />
            <TouchableOpacity
              onPress={() => setSimulationVisible(true)}
              activeOpacity={0.8}
              style={[styles.simBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.simIconWrap, { backgroundColor: '#4A9EFF22' }]}>
                <Ionicons name="flask-outline" size={20} color="#4A9EFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.simBtnTitle, { color: colors.text }]}>Run Simulation</Text>
                <Text style={[styles.simBtnSub, { color: colors.tabBarInactive }]}>
                  Test notifications & live price updates without real orders
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.tabBarInactive} />
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Strategy form modal */}
      <StrategyFormModal
        visible={modalVisible}
        isEditing={!!editingConfig}
        form={form}
        profiles={profiles ?? []}
        tickerOptions={tickerOptions}
        saving={saving}
        colors={colors}
        onClose={() => setModalVisible(false)}
        onPatch={patchForm}
        onModeSelect={handleModeSelect}
        onSave={handleSave}
      />

      <SimulationModal
        visible={simulationVisible}
        onClose={() => setSimulationVisible(false)}
        strategyId={configs?.[0]?.id}
      />

      <ProfileGuideModal
        visible={guideVisible}
        onClose={() => setGuideVisible(false)}
        colors={colors}
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

  const queryClient = useQueryClient();
  const onPositionClosed = useCallback(() => {
    // Immediately reflect the close: remove the position badge + surface the
    // finished trade in the log without waiting for the next scheduled poll.
    queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
  }, [queryClient]);

  const { data: live, connected: streaming } = useStrategyLivePrice(
    config.id,
    config.has_position === true,
    onPositionClosed,
  );
  const [exitOpen, setExitOpen]   = useState(false);
  const [expanded, setExpanded]   = useState(false);

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  }, []);

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

        {/* Row 2: profile + days + optional bypass badge */}
        <View style={styles.stratMeta}>
          <MetaChip label={config.profile.replace('_', ' ')} color={profileColor} />
          <MetaChip
            label={activeDays.map(d => DAY_LABELS[d]).join('/')}
            color={colors.tabBarInactive}
          />
          {config.bypass_breakout_window && (
            <MetaChip label="No Window" color="#FF9F0A" />
          )}
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
            {/* Tappable header row */}
            <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.7} style={styles.liveHeader}>
              <View style={[styles.modeDot, {
                backgroundColor: streaming ? colors.success : colors.tabBarInactive,
              }]} />
              <Text style={[styles.liveLabel, { color: colors.tabBarInactive }]}>
                {streaming ? 'LIVE' : 'CONNECTING'}
              </Text>
              {live && (
                <Text style={[styles.liveContract, { color: colors.tabBarInactive }]}>
                  {formatContractSymbolShort(live.contract)}
                </Text>
              )}
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.tabBarInactive}
                style={{ marginLeft: 'auto' }}
              />
            </TouchableOpacity>

            {live ? (
              <View style={styles.liveStats}>
                <View style={styles.liveStat}>
                  <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Price</Text>
                  <Text style={[styles.liveStatValue, { color: colors.text }]}>
                    ${live.mid_price.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.liveStat}>
                  <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>P&L</Text>
                  <Text style={[styles.liveStatValue, { color: pnlColor }]}>
                    {live.pnl >= 0 ? '+' : ''}${live.pnl.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.liveStat}>
                  <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Chg</Text>
                  <Text style={[styles.liveStatValue, { color: pnlColor }]}>
                    {live.pnl_pct >= 0 ? '+' : ''}{live.pnl_pct.toFixed(1)}%
                  </Text>
                </View>
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

            {/* Expanded detail */}
            {expanded && live && (
              <LivePositionDetail live={live} colors={colors} />
            )}

            {/* Manual exit */}
            <TouchableOpacity
              onPress={() => setExitOpen(true)}
              activeOpacity={0.8}
              style={[styles.exitBtn, { borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
            >
              <Ionicons name="exit-outline" size={16} color={colors.error} />
              <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
            </TouchableOpacity>
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

      <ExitTradeModal
        visible={exitOpen}
        colors={colors}
        strategyId={config.id}
        ticker={config.ticker}
        contract={live?.contract}
        qtyRemaining={live?.qty_remaining ?? config.qty_remaining ?? 1}
        paperMode={config.paper_mode}
        onClose={() => setExitOpen(false)}
      />
    </View>
  );
}

// ── ImmediatePositionCard ────────────────────────────────────────────────────────

function ImmediatePositionCard({ position, colors }: { position: ImmediatePosition; colors: any }) {
  const { data: live, connected } = useStrategyLivePrice(position.strategy_id, true);
  const [exitOpen, setExitOpen]   = useState(false);
  const [expanded, setExpanded]   = useState(false);

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  }, []);

  const pnl    = live?.pnl     ?? position.pnl     ?? 0;
  const pnlPct = live?.pnl_pct ?? position.pnl_pct ?? 0;
  const mid    = live?.mid_price ?? position.mid_price;
  const qty    = live?.qty_remaining ?? position.qty_remaining;
  const tp1    = live?.tp1_hit ?? position.tp1_hit;
  const tp2    = live?.tp2_hit ?? position.tp2_hit;

  const dirColor  = position.direction === 'CALL' ? colors.success : colors.error;
  const pnlColor  = pnl >= 0 ? colors.success : colors.error;
  const modeColor = position.paper_mode ? '#FF9F0A' : colors.success;

  return (
    <View style={[styles.stratCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.stratAccent, { backgroundColor: dirColor }]} />
      <View style={styles.stratBody}>
        <View style={styles.stratRow}>
          <View style={styles.stratTitleGroup}>
            <Text style={[styles.stratTicker, { color: colors.text }]}>
              {position.ticker} <Text style={{ color: dirColor }}>{position.direction}</Text>
            </Text>
            <Text style={[styles.stratName, { color: colors.tabBarInactive }]}>{formatContractSymbolShort(position.contract)}</Text>
          </View>
          <View style={[styles.modeBadge, { backgroundColor: modeColor + '22' }]}>
            <View style={[styles.modeDot, { backgroundColor: modeColor }]} />
            <Text style={[styles.modeBadgeText, { color: modeColor }]}>
              {position.paper_mode ? 'Paper' : 'Live'}
            </Text>
          </View>
        </View>

        <View style={styles.stratMeta}>
          <MetaChip label={position.profile.replace('_', ' ')} color={PROFILE_COLORS[position.profile] ?? colors.accent} />
          <MetaChip label="Immediate" color="#F59E0B" />
        </View>

        <View style={[styles.livePnlCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.7} style={styles.liveHeader}>
            <View style={[styles.modeDot, { backgroundColor: connected ? colors.success : colors.tabBarInactive }]} />
            <Text style={[styles.liveLabel, { color: colors.tabBarInactive }]}>
              {connected ? 'LIVE' : 'CONNECTING'}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.tabBarInactive}
              style={{ marginLeft: 'auto' }}
            />
          </TouchableOpacity>
          <View style={styles.liveStats}>
            <View style={styles.liveStat}>
              <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Price</Text>
              <Text style={[styles.liveStatValue, { color: colors.text }]}>
                {mid != null ? `$${mid.toFixed(2)}` : '—'}
              </Text>
            </View>
            <View style={styles.liveStat}>
              <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>P&L</Text>
              <Text style={[styles.liveStatValue, { color: pnlColor }]}>
                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
              </Text>
            </View>
            <View style={styles.liveStat}>
              <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Chg</Text>
              <Text style={[styles.liveStatValue, { color: pnlColor }]}>
                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
              </Text>
            </View>
            <View style={styles.liveStat}>
              <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>Qty</Text>
              <Text style={[styles.liveStatValue, { color: colors.text }]}>{qty}</Text>
            </View>
          </View>
          {(tp1 || tp2) && (
            <View style={styles.tpRow}>
              {tp1 && (
                <View style={[styles.tpBadge, { backgroundColor: colors.success + '22' }]}>
                  <Text style={[styles.tpBadgeText, { color: colors.success }]}>TP1 ✓</Text>
                </View>
              )}
              {tp2 && (
                <View style={[styles.tpBadge, { backgroundColor: colors.success + '22' }]}>
                  <Text style={[styles.tpBadgeText, { color: colors.success }]}>TP2 ✓</Text>
                </View>
              )}
            </View>
          )}

          {/* Expanded detail */}
          {expanded && live && (
            <LivePositionDetail live={live} colors={colors} />
          )}

          {/* Manual exit */}
          <TouchableOpacity
            onPress={() => setExitOpen(true)}
            activeOpacity={0.8}
            style={[styles.exitBtn, { borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
          >
            <Ionicons name="exit-outline" size={16} color={colors.error} />
            <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ExitTradeModal
        visible={exitOpen}
        colors={colors}
        strategyId={position.strategy_id}
        ticker={position.ticker}
        contract={position.contract}
        qtyRemaining={qty}
        paperMode={position.paper_mode}
        onClose={() => setExitOpen(false)}
      />
    </View>
  );
}

// ── LivePositionDetail ─────────────────────────────────────────────────────────

function LivePositionDetail({ live, colors }: { live: LiveOptionPrice; colors: any }) {
  return (
    <View style={[styles.liveDetail, { borderTopColor: colors.border }]}>
      <LiveDetailRow
        label="Entry"
        value={`$${live.entry_premium.toFixed(2)}`}
        colors={colors}
      />
      <LiveDetailRow
        label="Hard Stop"
        value={`$${live.hard_stop.toFixed(2)}`}
        valueColor={colors.error}
        colors={colors}
      />
      <LiveDetailRow
        label="TP1"
        value={`$${live.tp1.toFixed(2)}`}
        badge={live.tp1_hit ? 'Hit' : undefined}
        badgeColor={colors.success}
        colors={colors}
      />
      <LiveDetailRow
        label="TP2"
        value={`$${live.tp2.toFixed(2)}`}
        badge={live.tp2_hit ? 'Hit' : undefined}
        badgeColor={colors.success}
        colors={colors}
      />
    </View>
  );
}

function LiveDetailRow({
  label, value, valueColor, badge, badgeColor, colors,
}: {
  label: string;
  value: string;
  valueColor?: string;
  badge?: string;
  badgeColor?: string;
  colors: any;
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

// ── AccountBannerSide ──────────────────────────────────────────────────────────

interface AccountBannerSideProps {
  label: string;
  accentColor: string;
  account?: { available: boolean; equity?: number; pnl_today?: number; pnl_today_pct?: number; error?: string };
  colors: any;
}

function AccountBannerSide({ label, accentColor, account, colors }: AccountBannerSideProps) {
  const unavailable = !account?.available;
  const pnl    = account?.pnl_today ?? 0;
  const pnlPct = account?.pnl_today_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;

  return (
    <View style={styles.accountSide}>
      <View style={styles.accountSideLabel}>
        <View style={[styles.accountDot, { backgroundColor: accentColor }]} />
        <Text style={[styles.accountLabel, { color: colors.tabBarInactive }]}>{label}</Text>
      </View>
      {unavailable ? (
        <Text style={[styles.accountUnavailable, { color: colors.tabBarInactive }]}>—</Text>
      ) : (
        <>
          <Text style={[styles.accountEquity, { color: colors.text }]}>
            ${(account?.equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>
          <Text style={[styles.pnlToday, { color: pnlColor }]}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
          </Text>
        </>
      )}
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
  tickerOptions: string[];
  saving: boolean;
  colors: any;
  onClose: () => void;
  onPatch: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  onModeSelect: (mode: TradingMode) => void;
  onSave: () => void;
}

// Profiles always shown at the top of the picker.
const PRIMARY_PROFILES: ProfileKey[] = ['TREND_RIDER', 'RETESTER', 'REVERSAL'];
// Profiles hidden behind "More profiles" — legacy / advanced options.
const SECONDARY_PROFILES: ProfileKey[] = ['BULL_DOG', 'THUNDER_CAT', 'WOLF'];

function StrategyFormModal({
  visible, isEditing, form, profiles, tickerOptions, saving, colors,
  onClose, onPatch, onModeSelect, onSave,
}: FormModalProps) {
  const [tickerOpen, setTickerOpen]       = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [tab, setTab]                     = useState<'strategy' | 'immediate'>('strategy');
  // Auto-expand secondary section if the active profile lives there.
  const isSecondaryActive = SECONDARY_PROFILES.includes(form.profile) || form.profile === 'CUSTOM';
  const [showMoreProfiles, setShowMoreProfiles] = useState(isSecondaryActive);
  React.useEffect(() => { if (visible) setTab('strategy'); }, [visible]);
  // Re-expand if user saved a secondary profile and re-opens modal.
  React.useEffect(() => {
    if (visible && isSecondaryActive) setShowMoreProfiles(true);
  }, [visible, isSecondaryActive]);

  const showImmediate = !isEditing && tab === 'immediate';
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
          <TouchableOpacity onPress={onClose} hitSlop={12} style={{ width: 56 }}>
            <Text style={[styles.modalCancel, { color: colors.accent }]}>Cancel</Text>
          </TouchableOpacity>

          {isEditing ? (
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Strategy</Text>
          ) : (
            <View style={[styles.modalTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {(['strategy', 'immediate'] as const).map(t => {
                const active = tab === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setTab(t)}
                    activeOpacity={0.8}
                    style={[styles.modalTabBtn, active && { backgroundColor: colors.accent }]}
                  >
                    <Text style={[styles.modalTabText, { color: active ? colors.iconButton : colors.tabBarInactive }]}>
                      {t === 'strategy' ? 'Strategy' : 'Immediate'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {showImmediate ? (
            <View style={{ width: 56 }} />
          ) : (
            <TouchableOpacity onPress={onSave} disabled={saving} hitSlop={12} style={{ width: 56, alignItems: 'flex-end' }}>
              {saving
                ? <ActivityIndicator size="small" color={colors.accent} />
                : <Text style={[styles.modalSave, { color: colors.accent }]}>Save</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {showImmediate ? (
          <ImmediateTradePanel colors={colors} tickerOptions={tickerOptions} visible={visible} onClose={onClose} />
        ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={scrollEnabled}
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
            {/* Ticker — dropdown of all followed (orb_monitoring_state) tickers */}
            <ConfigRow label="Ticker" colors={colors}>
              <TouchableOpacity
                onPress={() => setTickerOpen(o => !o)}
                activeOpacity={0.7}
                style={[styles.tickerSelect, { backgroundColor: colors.border, borderColor: colors.border }]}
              >
                <Text style={[styles.tickerSelectText, { color: colors.text }]}>{form.ticker}</Text>
                <Ionicons
                  name={tickerOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.tabBarInactive}
                />
              </TouchableOpacity>
            </ConfigRow>

            {/* Ticker dropdown list */}
            {tickerOpen && (
              <View style={[styles.tickerMenu, { borderTopColor: colors.border }]}>
                {tickerOptions.map(t => {
                  const selected = form.ticker === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      onPress={() => { onPatch('ticker', t); setTickerOpen(false); }}
                      activeOpacity={0.7}
                      style={[
                        styles.tickerMenuItem,
                        selected && { backgroundColor: colors.accent + '1A' },
                      ]}
                    >
                      <Text style={[
                        styles.tickerMenuItemText,
                        { color: selected ? colors.accent : colors.text,
                          fontWeight: selected ? '700' : '500' },
                      ]}>
                        {t}
                      </Text>
                      {selected && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

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

          {/* Smart Contracts */}
          <SectionHeader title="Smart Contracts" colors={colors} />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.configRow, { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.configLabel, { color: colors.text }]}>Enable Smart Sizing</Text>
                <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>
                  Qty scales with ask price — cheaper contracts buy more, expensive ones buy fewer
                </Text>
              </View>
              <Switch
                value={form.smart_contracts}
                onValueChange={v => onPatch('smart_contracts', v)}
                thumbColor={form.smart_contracts ? '#30D158' : '#ccc'}
                trackColor={{ true: '#30D15855', false: colors.border }}
              />
            </View>
          </View>
          {form.smart_contracts && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: -4 }]}>
              {([
                ['ask < $1.00',          '4 contracts'],
                ['$1.00 – $1.49',        '2 contracts'],
                ['ask ≥ $1.50',          '1 contract'],
              ] as [string, string][]).map(([range, qty], i, arr) => (
                <View
                  key={range}
                  style={[
                    styles.configRow,
                    i < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                    { borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0 },
                  ]}
                >
                  <Text style={[styles.configLabel, { color: colors.tabBarInactive, fontSize: 13 }]}>{range}</Text>
                  <Text style={[styles.configLabel, { color: colors.text, fontWeight: '700', fontSize: 13 }]}>{qty}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
            Capital limit and buying power checks still apply after smart sizing.
          </Text>

          {/* Budget OTM Mode */}
          <SectionHeader title="Budget OTM Mode" colors={colors} />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[
              styles.configRow,
              form.budget_otm_mode
                ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }
                : { borderBottomWidth: 0 },
            ]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.configLabel, { color: colors.text }]}>Enable Budget Mode</Text>
                <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>
                  Target a cheaper OTM contract when capital is too low for the standard strike
                </Text>
              </View>
              <Switch
                value={form.budget_otm_mode}
                onValueChange={v => onPatch('budget_otm_mode', v)}
                thumbColor={form.budget_otm_mode ? '#4A9EFF' : '#ccc'}
                trackColor={{ true: '#4A9EFF55', false: colors.border }}
              />
            </View>

            {form.budget_otm_mode && (
              <View style={styles.budgetBody}>
                <Text style={[styles.hint, { color: colors.tabBarInactive, marginBottom: 12, marginTop: 0 }]}>
                  Strike is anchored to a Fibonacci extension of the ORB range. The option approaches ATM when the underlying reaches that level.
                </Text>

                {/* Fib level chips */}
                <View style={styles.fibChipRow}>
                  {(['1.0', '1.618', '2.618'] as OtmFibLevel[]).map(level => {
                    const selected = form.otm_fib_level === level;
                    return (
                      <TouchableOpacity
                        key={level}
                        onPress={() => onPatch('otm_fib_level', level)}
                        activeOpacity={0.7}
                        style={[
                          styles.fibChip,
                          selected
                            ? { borderColor: '#4A9EFF', backgroundColor: '#4A9EFF22' }
                            : { borderColor: colors.border, backgroundColor: colors.background },
                        ]}
                      >
                        <Text style={[styles.fibChipLabel, { color: selected ? '#4A9EFF' : colors.text }]}>
                          {level}×
                        </Text>
                        <Text style={[styles.fibChipSub, { color: selected ? '#4A9EFF' : colors.tabBarInactive }]}>
                          Fib
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <OtmRiskGuide level={form.otm_fib_level} colors={colors} />
              </View>
            )}
          </View>
          <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
            Only activates if your capital limit cannot afford 1 standard contract.
          </Text>

          {/* Breakout window */}
          <SectionHeader title="Breakout Window" colors={colors} />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.configRow, { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.configLabel, { color: colors.text }]}>Bypass Time Limit</Text>
                <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>
                  Allow entry at any time after ORB, ignoring the breakout window
                </Text>
              </View>
              <Switch
                value={form.bypass_breakout_window}
                onValueChange={v => onPatch('bypass_breakout_window', v)}
                thumbColor={form.bypass_breakout_window ? '#FF9F0A' : '#ccc'}
                trackColor={{ true: '#FF9F0A55', false: colors.border }}
              />
            </View>
          </View>

          {/* Profile picker — primary profiles always visible */}
          <SectionHeader title="Trading Profile" colors={colors} />
          {profiles
            .filter(p => PRIMARY_PROFILES.includes(p.key))
            .sort((a, b) => PRIMARY_PROFILES.indexOf(a.key) - PRIMARY_PROFILES.indexOf(b.key))
            .map(p => (
              <ProfileCard
                key={p.key}
                profile={p}
                selected={form.profile === p.key}
                onSelect={key => onPatch('profile', key)}
              />
            ))}

          {/* "More profiles" toggle */}
          <TouchableOpacity
            onPress={() => setShowMoreProfiles(v => !v)}
            activeOpacity={0.7}
            style={[styles.moreProfilesBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.moreProfilesBtnText, { color: colors.tabBarInactive }]}>
              {showMoreProfiles ? 'Fewer profiles' : 'More profiles'}
            </Text>
            <Ionicons
              name={showMoreProfiles ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.tabBarInactive}
            />
          </TouchableOpacity>

          {/* Secondary profiles + Custom — hidden until expanded */}
          {showMoreProfiles && (
            <>
              {profiles
                .filter(p => SECONDARY_PROFILES.includes(p.key))
                .sort((a, b) => SECONDARY_PROFILES.indexOf(a.key) - SECONDARY_PROFILES.indexOf(b.key))
                .map(p => (
                  <ProfileCard
                    key={p.key}
                    profile={p}
                    selected={form.profile === p.key}
                    onSelect={key => onPatch('profile', key)}
                  />
                ))}

              {/* Custom profile card */}
              <TouchableOpacity
                onPress={() => onPatch('profile', 'CUSTOM')}
                activeOpacity={0.8}
                style={[
                  styles.customProfileCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: form.profile === 'CUSTOM' ? '#A855F7' : colors.border,
                    borderWidth: form.profile === 'CUSTOM' ? 2 : 1,
                  },
                ]}
              >
                {form.profile === 'CUSTOM' && (
                  <View style={[styles.customActiveBadge, { backgroundColor: '#A855F7' }]}>
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  </View>
                )}
                <Text style={styles.customProfileEmoji}>⚙️</Text>
                <Text style={[styles.customProfileName, { color: colors.text }]}>Custom</Text>
                <Text style={[styles.customProfileSub, { color: '#A855F7' }]}>Custom Risk</Text>
                <Text style={[styles.customProfileDesc, { color: colors.tabBarInactive }]}>
                  Set every parameter yourself — contracts, take-profit targets, timing, and more.
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Custom thresholds editor — only shown when CUSTOM is selected */}
          {form.profile === 'CUSTOM' && (
            <CustomThresholdsEditor
              thresholds={form.custom_thresholds}
              onChange={t => onPatch('custom_thresholds', t)}
              colors={colors}
              onDragStart={() => setScrollEnabled(false)}
              onDragEnd={() => setScrollEnabled(true)}
            />
          )}

          {/* Exit Controls — non-CUSTOM only; CUSTOM sets these in the thresholds editor */}
          {form.profile !== 'CUSTOM' && (
            <>
              <SectionHeader title="Exit Controls" colors={colors} />
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.configRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.configLabel, { color: colors.text }]}>Consolidation Exit</Text>
                    <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>
                      Close when price stops moving after 5 min
                    </Text>
                  </View>
                  <Switch
                    value={form.consol_exit}
                    onValueChange={v => onPatch('consol_exit', v)}
                    thumbColor={form.consol_exit ? '#4A9EFF' : '#ccc'}
                    trackColor={{ true: '#4A9EFF55', false: colors.border }}
                  />
                </View>
                <View style={[styles.configRow, { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.configLabel, { color: colors.text }]}>Volume Exit</Text>
                    <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>
                      Close half position on low volume after 3 min
                    </Text>
                  </View>
                  <Switch
                    value={form.volume_exit}
                    onValueChange={v => onPatch('volume_exit', v)}
                    thumbColor={form.volume_exit ? '#4A9EFF' : '#ccc'}
                    trackColor={{ true: '#4A9EFF55', false: colors.border }}
                  />
                </View>
              </View>
              <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
                Both are off by default. Enable only when you want automated early exits.
              </Text>
            </>
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── OTM Risk Guide ─────────────────────────────────────────────────────────────

const OTM_GUIDE: Record<OtmFibLevel, {
  risk: string; riskColor: string; delta: string; premium: string;
  stop: string; atmAt: string; typicalWin: string; bigMove: string; desc: string;
}> = {
  '1.0': {
    risk:       'Medium',
    riskColor:  '#FF9F0A',
    delta:      '0.14 – 0.26',
    premium:    '$0.20 – $0.60',
    stop:       '45%',
    atmAt:      'TP1 zone  (1× ORB range)',
    typicalWin: '+80 – 120%',
    bigMove:    '+250%+',
    desc:       'Nearest budget strike. Reacts meaningfully to a standard TP1-sized move.',
  },
  '1.618': {
    risk:       'High',
    riskColor:  '#FF6B35',
    delta:      '0.08 – 0.17',
    premium:    '$0.08 – $0.25',
    stop:       '55%',
    atmAt:      'TP2 zone  (1.618× ORB range)',
    typicalWin: '+120 – 200%',
    bigMove:    '+500%+',
    desc:       'Golden ratio extension. Cheap premium with a large % gain if TP2 is hit.',
  },
  '2.618': {
    risk:       'Very High',
    riskColor:  '#FF453A',
    delta:      '0.03 – 0.09',
    premium:    '$0.03 – $0.10',
    stop:       '65%',
    atmAt:      'Beyond TP2  (2.618× ORB range)',
    typicalWin: '+200 – 400%',
    bigMove:    '+1000%+',
    desc:       'Very deep OTM. Near-zero delta; requires a strong breakout to pay off.',
  },
};

function OtmRiskGuide({ level, colors }: { level: OtmFibLevel; colors: any }) {
  const g = OTM_GUIDE[level];
  const rows: [string, string][] = [
    ['Delta range',     g.delta],
    ['Est. premium',    g.premium],
    ['Hard stop',       g.stop],
    ['Near ATM at',     g.atmAt],
    ['Typical winner',  g.typicalWin],
    ['Big move',        g.bigMove],
  ];
  return (
    <View style={[otmGuideStyles.card, { borderColor: g.riskColor + '66' }]}>
      <View style={otmGuideStyles.header}>
        <Text style={[otmGuideStyles.title, { color: colors.text }]}>{level}× Fib — Risk Guide</Text>
        <View style={[otmGuideStyles.badge, { backgroundColor: g.riskColor + '22' }]}>
          <Text style={[otmGuideStyles.badgeText, { color: g.riskColor }]}>{g.risk}</Text>
        </View>
      </View>
      <Text style={[otmGuideStyles.desc, { color: colors.tabBarInactive }]}>{g.desc}</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={otmGuideStyles.row}>
          <Text style={[otmGuideStyles.rowLabel, { color: colors.tabBarInactive }]}>{label}</Text>
          <Text style={[otmGuideStyles.rowValue, { color: colors.text }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const otmGuideStyles = StyleSheet.create({
  card:      { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 8 },
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title:     { fontSize: 13, fontWeight: '700' },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  desc:      { fontSize: 12, lineHeight: 16, marginBottom: 10 },
  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  rowLabel:  { fontSize: 12 },
  rowValue:  { fontSize: 12, fontWeight: '600' },
});

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
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title:     { fontSize: 20, fontWeight: '700' },
  addBtn:    { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  guideBtn:  { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  accountCard:      { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  accountSide:      { flex: 1, gap: 3 },
  accountSideLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  accountDot:       { width: 7, height: 7, borderRadius: 4 },
  accountDivider:   { width: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  accountLabel:     { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  accountEquity:    { fontSize: 18, fontWeight: '700' },
  accountUnavailable: { fontSize: 18, fontWeight: '700' },
  pnlToday:         { fontSize: 12, fontWeight: '600' },

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
  exitBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 9, borderRadius: 9, borderWidth: 1 },
  exitBtnText:    { fontSize: 13, fontWeight: '700' },

  liveDetail:          { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  liveDetailRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveDetailLabel:     { fontSize: 12, fontWeight: '500' },
  liveDetailRight:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDetailValue:     { fontSize: 13, fontWeight: '700' },
  liveDetailBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  liveDetailBadgeText: { fontSize: 10, fontWeight: '700' },

  stratActions: { justifyContent: 'center', gap: 12, paddingHorizontal: 10 },
  actionBtn:    { padding: 4 },

  emptyCard:    { alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 32, gap: 8, marginBottom: 12 },
  emptyText:    { fontSize: 15, fontWeight: '600' },
  emptySubtext: { fontSize: 13 },

  // ── More profiles toggle ──
  moreProfilesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  moreProfilesBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Custom profile card ──
  customProfileCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    position: 'relative',
  },
  customActiveBadge: {
    position: 'absolute', top: 10, right: 10,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  customProfileEmoji: { fontSize: 28, marginBottom: 4 },
  customProfileName:  { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  customProfileSub:   { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  customProfileDesc:  { fontSize: 12, lineHeight: 17 },

  // ── Budget OTM ──
  budgetBody:   { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 8 },
  fibChipRow:   { flexDirection: 'row', gap: 8, marginBottom: 4 },
  fibChip:      { flex: 1, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  fibChipLabel: { fontSize: 16, fontWeight: '700' },
  fibChipSub:   { fontSize: 10, fontWeight: '500', marginTop: 1 },

  // ── Simulation button ──
  simBtn:      { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  simIconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  simBtnTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  simBtnSub:   { fontSize: 12 },

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
  modalTabs:   { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  modalTabBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
  modalTabText:{ fontSize: 13, fontWeight: '700' },
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

  tickerSelect:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, minWidth: 90, justifyContent: 'space-between' },
  tickerSelectText: { fontSize: 13, fontWeight: '700' },
  tickerMenu:       { borderTopWidth: StyleSheet.hairlineWidth },
  tickerMenuItem:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  tickerMenuItemText: { fontSize: 14 },
});
