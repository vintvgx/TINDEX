import React, { useState, useCallback, useMemo } from 'react';
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
import { StrategyDetailModal } from '@/common/components/strategy/StrategyDetailModal';
import { useFloatingTabBarHeight } from '@/common/components/ui/CustomTabBar';
import { LiveModeToggle, type AccountMode } from '@/common/components/strategy/LiveModeToggle';
import { OrbHubHealthBanner } from '@/common/components/strategy/OrbHubHealthBanner';
import { ImmediateTradePanel } from '@/common/components/strategy/ImmediateTradePanel';
import { ExitTradeModal } from '@/common/components/strategy/ExitTradeModal';
import { EditExitsButton } from '@/common/components/shared/EditExitsButton';
import { positionHideKey } from '@/lib/positionHideKey';
import { useStrategyTrades } from '@/hooks/queries/strategy/useStrategyTrades';
import type { StrategyConfig, ProfileKey, StrategyProfile, CustomThresholds, OtmFibLevel, LiveOptionPrice, ExitOverrides, ORBTrade } from '@/common/types/strategy';
import { formatContractSymbolShort } from '@/lib/formatContract';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];

// ORB-covered ETFs always sort first (alphabetically among themselves), then
// everything else alphabetically — so the tickers the strategy actually
// monitors don't get buried in an alphabetical list of ad-hoc symbols.
function etfsFirstComparator(a: string, b: string): number {
  const aEtf = FALLBACK_TICKERS.includes(a);
  const bEtf = FALLBACK_TICKERS.includes(b);
  if (aEtf !== bEtf) return aEtf ? -1 : 1;
  return a.localeCompare(b);
}

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
  SCALPER:     '#22C55E',
  PRECISION:   '#84CC16',
  MOMENTUM:    '#F59E0B',
  CONVICTION:    '#F97316',
  ALL_IN:        '#EF4444',
  OTM_RUNNER:    '#8B5CF6',
  OTM_CONVICTION:'#EC4899',
  MANUAL:        '#94A3B8',
  NO_STOP_LOSS:  '#64748B',
  SL_5:          '#FF9F0A',
  SL_10:         '#FF7A00',
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

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
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
  override_enabled:       boolean;
  budget_otm_mode:        boolean;
  otm_fib_level:          OtmFibLevel;
  smart_contracts:        boolean;
  confirm_entry:          boolean;
  consol_exit:            boolean;
  volume_exit:            boolean;
  paired_strategy_id:     string | null;
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
  override_enabled:       false,
  budget_otm_mode:        false,
  otm_fib_level:          '1.0',
  smart_contracts:        false,
  confirm_entry:          false,
  consol_exit:            false,
  volume_exit:            false,
  paired_strategy_id:     null,
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
    override_enabled:       cfg.profile !== 'CUSTOM' && cfg.custom_thresholds != null,
    budget_otm_mode:        cfg.budget_otm_mode ?? false,
    otm_fib_level:          cfg.otm_fib_level ?? '1.0',
    smart_contracts:        cfg.smart_contracts ?? false,
    confirm_entry:          cfg.confirm_entry ?? false,
    consol_exit:            cfg.exit_overrides?.consol_exit ?? false,
    volume_exit:            cfg.exit_overrides?.volume_exit ?? false,
    paired_strategy_id:     cfg.paired_strategy_id ?? null,
  };
}

// ── Main screen ────────────────────────────────────────────────────────────────

interface StrategyScreenProps {
  /** True when rendered as a SegmentedPager scene (ORB tab) — hides the
   *  redundant title (the segment pill above already names this page). */
  embedded?: boolean;
}

export default function StrategyScreen({ embedded = false }: StrategyScreenProps) {
  const colors  = useThemeColors();
  const toast   = useToast();
  const tabBarHeight = useFloatingTabBarHeight();

  const { data: configs,  isLoading: configsLoading  } = useStrategyConfigs();
  const { data: profiles, isLoading: profilesLoading } = useStrategyProfiles();
  const { data: accounts } = useAlpacaBothAccounts(!!(configs && configs.length > 0));
  const { data: monitoringState } = useORBMonitoringState();
  const { data: recentTrades } = useStrategyTrades({ limit: 50 });

  // Decoupled LIVE/PAPER view — everything below (positions, strategies,
  // today's results, the account card) is scoped to one account at a time
  // instead of mixing real and paper money together. Defaults to LIVE since
  // that's where actual capital is at risk.
  const [accountMode, setAccountMode] = useState<AccountMode>('live');
  const wantPaper = accountMode === 'paper';

  const tickerOptions = useMemo(() => {
    const tickers = (monitoringState ?? [])
      .map(s => s.ticker)
      .filter((t): t is string => !!t);
    const unique = Array.from(new Set(tickers.length ? tickers : FALLBACK_TICKERS));
    return unique.sort(etfsFirstComparator);
  }, [monitoringState]);

  // Today's completed trades (exit_time is set = fully closed)
  const today = todayISODate();
  const todayCompletedTrades = useMemo<ORBTrade[]>(() => {
    if (!recentTrades) return [];
    return recentTrades.filter(t =>
      t.trade_date?.slice(0, 10) === today && t.exit_time != null
    );
  }, [recentTrades, today]);

  // Everything below is scoped to the selected account (LIVE or PAPER).
  const modeConfigs = useMemo(
    () => (configs ?? []).filter(c => c.paper_mode === wantPaper),
    [configs, wantPaper],
  );
  const modeTodayCompletedTrades = useMemo(
    () => todayCompletedTrades.filter(t => (t.paper_mode ?? false) === wantPaper),
    [todayCompletedTrades, wantPaper],
  );

  // Split configs: those with live positions vs the rest
  const liveStrategyConfigs = useMemo(
    () => modeConfigs.filter(c => c.has_position === true),
    [modeConfigs],
  );
  const inactiveStrategyConfigs = useMemo(() => {
    // Configs without a live position, sorted: live mode > paper mode > off
    const modeOrder: Record<TradingMode, number> = { live: 0, paper: 1, off: 2 };
    return modeConfigs
      .filter(c => !c.has_position)
      .sort((a, b) => modeOrder[getMode(a)] - modeOrder[getMode(b)]);
  }, [modeConfigs]);

  // Completed strategy trades today that haven't already been surfaced as live positions
  const completedStrategyTrades = useMemo<ORBTrade[]>(() => {
    const liveIds = new Set(liveStrategyConfigs.map(c => c.id));
    return modeTodayCompletedTrades.filter(
      t => t.trade_type !== 'IMMEDIATE' && (t.strategy_id == null || !liveIds.has(t.strategy_id))
    );
  }, [modeTodayCompletedTrades, liveStrategyConfigs]);

  const hasLiveActivity = liveStrategyConfigs.length > 0;
  const hasCompletedToday = completedStrategyTrades.length > 0;

  const { mutate: createConfig } = useCreateStrategyConfig();
  const { mutate: updateConfig } = useUpdateStrategyConfig();
  const { mutate: deleteConfig } = useDeleteStrategyConfig();

  const [modalVisible, setModalVisible]     = useState(false);
  const [simulationVisible, setSimulationVisible] = useState(false);
  const [editingConfig, setEditingConfig]   = useState<StrategyConfig | null>(null);
  const [form, setForm]                     = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving]                 = useState(false);
  const [guideVisible, setGuideVisible]     = useState(false);
  const [detailConfig, setDetailConfig]     = useState<StrategyConfig | null>(null);
  const [detailVisible, setDetailVisible]   = useState(false);

  const openCreate = () => { setEditingConfig(null); setForm(DEFAULT_FORM); setModalVisible(true); };
  const openEdit   = (cfg: StrategyConfig) => { setEditingConfig(cfg); setForm(configToForm(cfg)); setModalVisible(true); };
  const openDetail = (cfg: StrategyConfig) => { setDetailConfig(cfg); setDetailVisible(true); };

  // Candidates for "Paired Strategy": same ticker, the opposite paper/live
  // mode, excluding the config being edited — this is what
  // ORBEngine._find_ticker_conflict treats as an intentional mirrored pair.
  const pairOptions = useMemo(() => {
    const formPaperMode = form.mode === 'paper';
    return (configs ?? []).filter(c =>
      c.id !== editingConfig?.id &&
      c.ticker === form.ticker &&
      c.paper_mode !== formPaperMode
    );
  }, [configs, editingConfig, form.mode, form.ticker]);

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
      custom_thresholds:      (form.profile === 'CUSTOM' || form.override_enabled) ? form.custom_thresholds : null,
      exit_overrides:         exitOverrides,
      budget_otm_mode:        form.budget_otm_mode,
      otm_fib_level:          form.otm_fib_level,
      smart_contracts:        form.smart_contracts,
      confirm_entry:          form.confirm_entry,
      paired_strategy_id:     form.paired_strategy_id,
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
        {!embedded && <Text style={[styles.title, { color: colors.text }]}>ORB Strategies</Text>}
        <TouchableOpacity
          onPress={openCreate}
          hitSlop={8}
          style={[styles.addBtn, { backgroundColor: colors.accent }]}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={20} color={colors.iconButton} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight }]}>

        <OrbHubHealthBanner colors={colors} />

        {/* LIVE/PAPER — everything below is scoped to one account at a time */}
        <LiveModeToggle
          mode={accountMode}
          onChange={setAccountMode}
          counts={{
            live: (configs ?? []).filter(c => !c.paper_mode && c.has_position).length,
            paper: (configs ?? []).filter(c => c.paper_mode && c.has_position).length,
          }}
          colors={colors}
        />

        {/* Account banner — just the selected account, not both side by side */}
        {accounts && (
          <View style={[styles.accountCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <AccountBannerSide
              label={accountMode.toUpperCase()}
              accentColor={wantPaper ? '#FF9F0A' : colors.success}
              account={wantPaper ? accounts.paper : accounts.live}
              colors={colors}
            />
          </View>
        )}

        {/* ── LIVE POSITIONS ─────────────────────────────────────────────────── */}
        {/* Strategy view shows only saved-strategy positions — immediate
            (manual/ad-hoc) trades belong on Dashboard/Live Positions, not here. */}
        {hasLiveActivity && (
          <>
            <SectionHeader
              title={`Open Positions (${liveStrategyConfigs.length})`}
              accent
              colors={colors}
            />

            {liveStrategyConfigs.map(cfg => (
              <StrategyCard
                key={cfg.id}
                config={cfg}
                profiles={profiles ?? []}
                colors={colors}
                onPress={() => openDetail(cfg)}
              />
            ))}
          </>
        )}

        {/* ── TODAY'S RESULTS ─────────────────────────────────────────────────── */}
        {hasCompletedToday && (
          <>
            <SectionHeader title="Today's Results" colors={colors} />
            {completedStrategyTrades.map(trade => (
              <CompletedTradeCard key={trade.id} trade={trade} colors={colors} />
            ))}
          </>
        )}

        {/* ── ALL STRATEGIES ──────────────────────────────────────────────────── */}
        {inactiveStrategyConfigs.length > 0 && (
          <>
            <SectionHeader
              title={`Strategies (${inactiveStrategyConfigs.length})`}
              colors={colors}
            />
            {inactiveStrategyConfigs.map(cfg => (
              <StrategyCard
                key={cfg.id}
                config={cfg}
                profiles={profiles ?? []}
                colors={colors}
                onPress={() => openDetail(cfg)}
              />
            ))}
          </>
        )}

        {/* Empty state — no strategies at all */}
        {(!configs || configs.length === 0) && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="bar-chart-outline" size={32} color={colors.tabBarInactive} />
            <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>No strategies configured</Text>
            <Text style={[styles.emptySubtext, { color: colors.tabBarInactive }]}>Tap + to add your first strategy</Text>
          </View>
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

      <StrategyFormModal
        visible={modalVisible}
        isEditing={!!editingConfig}
        form={form}
        profiles={profiles ?? []}
        tickerOptions={tickerOptions}
        pairOptions={pairOptions}
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

      <StrategyDetailModal
        visible={detailVisible}
        config={detailConfig}
        profiles={profiles ?? []}
        colors={colors}
        onClose={() => setDetailVisible(false)}
        onEdit={() => detailConfig && openEdit(detailConfig)}
        onDelete={() => detailConfig && handleDelete(detailConfig)}
      />
    </SafeAreaView>
  );
}

// ── StrategyCard ───────────────────────────────────────────────────────────────

interface StrategyCardProps {
  config: StrategyConfig;
  profiles: StrategyProfile[];
  colors: any;
  onPress: () => void;
}

function StrategyCard({ config, profiles, colors, onPress }: StrategyCardProps) {
  const mode         = getMode(config);
  const modeMeta     = MODE_META[mode];
  const profileColor = PROFILE_COLORS[config.profile] ?? colors.accent;
  const activeDays   = config.trade_days ?? [];
  const hasPosition  = config.has_position === true;
  const qtyContracts = config.custom_thresholds?.qty_contracts
    ?? profiles.find(p => p.key === config.profile)?.thresholds.qty_contracts;

  const queryClient = useQueryClient();
  const onPositionClosed = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
  }, [queryClient]);

  const { data: live, connected: streaming, patchData } = useStrategyLivePrice(
    config.id,
    hasPosition,
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
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.stratCard, { backgroundColor: colors.card, borderColor: hasPosition ? profileColor + '55' : colors.border }]}
    >
      {/* Left accent bar — brighter when position is live */}
      <View style={[styles.stratAccent, { backgroundColor: profileColor, opacity: hasPosition ? 1 : 0.5 }]} />

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
          <MetaChip label={activeDays.map(d => DAY_LABELS[d]).join('/')} color={colors.tabBarInactive} />
          {config.bypass_breakout_window && <MetaChip label="No Window" color="#FF9F0A" />}
        </View>

        {/* Row 3: contracts + confirm-entry flags */}
        <View style={styles.stratMeta}>
          {qtyContracts != null && (
            <MetaChip label={`${qtyContracts} contract${qtyContracts === 1 ? '' : 's'}`} color={colors.tabBarInactive} />
          )}
          <MetaChip
            label={config.confirm_entry ? 'Confirm Entry' : 'Auto Entry'}
            color={config.confirm_entry ? '#30D158' : colors.tabBarInactive}
          />
        </View>

        {config.capital_limit != null && (
          <Text style={[styles.stratCapital, { color: colors.tabBarInactive }]}>
            Capital: ${config.capital_limit.toLocaleString()}
          </Text>
        )}

        {/* ── Live position panel (PositionCard style) ── */}
        {hasPosition && (
          <View style={[styles.livePnlCard, { backgroundColor: colors.background, borderColor: profileColor + '44' }]}>

            {/* Header row: streaming dot + label + contract + P&L */}
            <TouchableOpacity onPress={toggleExpanded} activeOpacity={0.7} style={styles.liveHeaderRow}>
              <View style={styles.liveHeaderLeft}>
                <View style={[styles.modeDot, {
                  backgroundColor: streaming ? colors.success : colors.tabBarInactive,
                }]} />
                <Text style={[styles.liveLabel, { color: streaming ? colors.success : colors.tabBarInactive }]}>
                  {streaming ? 'LIVE' : 'CONNECTING'}
                </Text>
                {live && (
                  <Text style={[styles.liveContract, { color: colors.tabBarInactive }]}>
                    {formatContractSymbolShort(live.contract)}
                  </Text>
                )}
              </View>
              {live && (
                <View style={styles.liveHeaderRight}>
                  <Text style={[styles.livePnlValue, { color: pnlColor }]}>
                    {live.pnl >= 0 ? '+' : ''}${live.pnl.toFixed(2)}
                  </Text>
                  <View style={[styles.pnlPctPill, { backgroundColor: pnlColor + '1A' }]}>
                    <Text style={[styles.pnlPctText, { color: pnlColor }]}>
                      {live.pnl_pct >= 0 ? '+' : ''}{live.pnl_pct.toFixed(1)}%
                    </Text>
                  </View>
                  <Text style={[styles.mktValText, { color: colors.tabBarInactive }]}>
                    Mkt ${(live.market_value ?? live.mid_price * live.qty_remaining * 100).toFixed(2)}
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

            {/* Stats row: Price | Qty | TP hits */}
            {live ? (
              <>
                <View style={styles.liveStats}>
                  <LiveStat label="Entry"  value={`$${live.entry_premium.toFixed(2)}`} colors={colors} />
                  <LiveStat label="Price"  value={`$${live.mid_price.toFixed(2)}`}     colors={colors} highlight />
                  <LiveStat label="Qty"    value={String(live.qty_remaining)}          colors={colors} />
                  <LiveStat
                    label="Stop"
                    value={`$${live.hard_stop.toFixed(2)}`}
                    colors={colors}
                    valueColor={colors.error}
                  />
                </View>

                {/* Stop/TP progression bar */}
                <PositionStopBar live={live} colors={colors} />

                {/* TP hit badges */}
                {(live.tp1_hit || live.tp2_hit) && (
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
                {expanded && <LivePositionDetail live={live} colors={colors} />}
              </>
            ) : (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
            )}

            {/* Edit exits + manual exit */}
            <View style={styles.liveActionsRow}>
              {live && (
                <EditExitsButton
                  mode="orb"
                  strategy_id={config.id}
                  ticker={config.ticker}
                  hard_stop={live.hard_stop}
                  tp1={live.tp1}
                  tp2={live.tp2}
                  entry_premium={live.entry_premium}
                  tp1_hit={live.tp1_hit}
                  tp2_hit={live.tp2_hit}
                  hideKey={positionHideKey({ strategy_id: config.id, contract: live.contract, entry_premium: live.entry_premium })}
                  onUpdated={patchData}
                  style={{ flex: 1 }}
                />
              )}
              <TouchableOpacity
                onPress={() => setExitOpen(true)}
                activeOpacity={0.8}
                style={[styles.exitBtn, { flex: 1, marginTop: 0, borderColor: colors.error + '55', backgroundColor: colors.error + '14' }]}
              >
                <Ionicons name="exit-outline" size={16} color={colors.error} />
                <Text style={[styles.exitBtnText, { color: colors.error }]}>Exit Position</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
    </TouchableOpacity>
  );
}

// ── PositionStopBar ─────────────────────────────────────────────────────────────

function PositionStopBar({ live, colors }: { live: LiveOptionPrice; colors: any }) {
  const stages = [
    { label: 'Stop', value: live.hard_stop,     active: !live.tp1_hit,  color: colors.error },
    { label: 'TP1',  value: live.tp1,           active: live.tp1_hit && !live.tp2_hit, color: '#4A9EFF' },
    { label: 'TP2',  value: live.tp2,           active: live.tp2_hit,   color: colors.success },
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

// ── CompletedTradeCard ────────────────────────────────────────────────────────

function CompletedTradeCard({ trade, colors }: { trade: ORBTrade; colors: any }) {
  const pnl     = trade.pnl ?? 0;
  const pnlPct  = trade.pnl_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const dirColor = trade.direction === 'CALL' ? colors.success : colors.error;
  const isImmediate = trade.trade_type === 'IMMEDIATE';

  const exitTime = trade.exit_time
    ? new Date(trade.exit_time).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true,
      })
    : null;

  return (
    <View style={[styles.stratCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.stratAccent, { backgroundColor: pnlColor, opacity: 0.7 }]} />
      <View style={[styles.stratBody]}>
        <View style={styles.stratRow}>
          <View style={styles.stratTitleGroup}>
            <Text style={[styles.stratTicker, { color: colors.text }]}>
              {trade.ticker}{' '}
              <Text style={{ color: dirColor, fontSize: 14 }}>{trade.direction}</Text>
            </Text>
            <Text style={[styles.stratName, { color: colors.tabBarInactive }]}>
              {formatContractSymbolShort(trade.contract_symbol)}
            </Text>
          </View>
          {/* P&L on right */}
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.livePnlValue, { color: pnlColor }]}>
              {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
            </Text>
            <View style={[styles.pnlPctPill, { backgroundColor: pnlColor + '1A' }]}>
              <Text style={[styles.pnlPctText, { color: pnlColor }]}>
                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
              </Text>
            </View>
          </View>
        </View>

        {/* Meta */}
        <View style={styles.stratMeta}>
          <MetaChip label="CLOSED" color={pnlColor} />
          <MetaChip label={isImmediate ? 'IMMED' : 'STRATEGY'} color={isImmediate ? '#F59E0B' : colors.tabBarInactive} />
          {trade.paper_mode && <MetaChip label="PAPER" color="#FF9F0A" />}
          {trade.exit_reason && (
            <MetaChip label={trade.exit_reason.replace(/_/g, ' ')} color={colors.tabBarInactive} />
          )}
        </View>

        {/* Entry → Exit */}
        <View style={[styles.closedDetails, { borderTopColor: colors.border }]}>
          <ClosedStat label="Entry" value={`$${(trade.entry_premium ?? 0).toFixed(2)}`} colors={colors} />
          <Ionicons name="arrow-forward" size={12} color={colors.tabBarInactive} />
          <ClosedStat label="Exit" value={trade.exit_premium != null ? `$${trade.exit_premium.toFixed(2)}` : '—'} colors={colors} highlight={pnlColor} />
          {exitTime && <ClosedStat label="Time" value={exitTime} colors={colors} />}
        </View>
      </View>
    </View>
  );
}

function ClosedStat({ label, value, colors, highlight }: { label: string; value: string; colors: any; highlight?: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>{label}</Text>
      <Text style={[styles.liveStatValue, { color: highlight ?? colors.text, fontSize: 12 }]}>{value}</Text>
    </View>
  );
}

// ── LivePositionDetail ─────────────────────────────────────────────────────────

function LivePositionDetail({ live, colors }: { live: LiveOptionPrice; colors: any }) {
  return (
    <View style={[styles.liveDetail, { borderTopColor: colors.border }]}>
      <LiveDetailRow label="Entry"     value={`$${live.entry_premium.toFixed(2)}`} colors={colors} />
      <LiveDetailRow label="Hard Stop" value={`$${live.hard_stop.toFixed(2)}`}     valueColor={colors.error} colors={colors} />
      <LiveDetailRow label="TP1"       value={`$${live.tp1.toFixed(2)}`}           badge={live.tp1_hit ? 'Hit' : undefined} badgeColor={colors.success} colors={colors} />
      <LiveDetailRow label="TP2"       value={`$${live.tp2.toFixed(2)}`}           badge={live.tp2_hit ? 'Hit' : undefined} badgeColor={colors.success} colors={colors} />
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

// ── Small helpers ──────────────────────────────────────────────────────────────

const MetaChip = ({ label, color }: { label: string; color: string }) => (
  <View style={[styles.metaChip, { borderColor: color + '55', backgroundColor: color + '11' }]}>
    <Text style={[styles.metaChipText, { color }]}>{label}</Text>
  </View>
);

const LiveStat = ({ label, value, colors, highlight, valueColor }: {
  label: string; value: string; colors: any; highlight?: boolean; valueColor?: string;
}) => (
  <View style={styles.liveStat}>
    <Text style={[styles.liveStatLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.liveStatValue, { color: valueColor ?? (highlight ? colors.accent : colors.text) }]}>{value}</Text>
  </View>
);

interface SectionHeaderProps { title: string; colors: any; accent?: boolean; }
const SectionHeader = ({ title, colors, accent }: SectionHeaderProps) => (
  <View style={styles.sectionHeaderRow}>
    {accent && <View style={[styles.sectionAccentDot, { backgroundColor: colors.success }]} />}
    <Text style={[styles.sectionHeader, { color: accent ? colors.success : colors.tabBarInactive }]}>{title}</Text>
  </View>
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

// ── StrategyFormModal ──────────────────────────────────────────────────────────

interface FormModalProps {
  visible: boolean;
  isEditing: boolean;
  form: FormState;
  profiles: StrategyProfile[];
  tickerOptions: string[];
  pairOptions: StrategyConfig[];
  saving: boolean;
  colors: any;
  onClose: () => void;
  onPatch: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
  onModeSelect: (mode: TradingMode) => void;
  onSave: () => void;
}

const PRIMARY_PROFILES: ProfileKey[] = ['TREND_RIDER', 'RETESTER', 'REVERSAL'];
const SECONDARY_PROFILES: ProfileKey[] = ['BULL_DOG', 'THUNDER_CAT', 'WOLF'];

function StrategyFormModal({
  visible, isEditing, form, profiles, tickerOptions, pairOptions, saving, colors,
  onClose, onPatch, onModeSelect, onSave,
}: FormModalProps) {
  const [tickerOpen, setTickerOpen]       = useState(false);
  const [pairOpen, setPairOpen]           = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [tab, setTab]                     = useState<'strategy' | 'immediate'>('strategy');
  const isSecondaryActive = SECONDARY_PROFILES.includes(form.profile) || form.profile === 'CUSTOM';
  const [showMoreProfiles, setShowMoreProfiles] = useState(isSecondaryActive);
  React.useEffect(() => { if (visible) setTab('strategy'); }, [visible]);
  React.useEffect(() => { if (visible && isSecondaryActive) setShowMoreProfiles(true); }, [visible, isSecondaryActive]);

  // Selecting a new archetype while overrides are on re-seeds the editor from
  // that profile's real defaults — otherwise a Bull Dog TP1 (+20%) would carry
  // over as a Wolf override, which reads as a different profile entirely.
  const handleProfileSelect = (key: ProfileKey) => {
    onPatch('profile', key);
    if (form.override_enabled && key !== 'CUSTOM') {
      const base = profiles.find(p => p.key === key)?.thresholds;
      if (base) onPatch('custom_thresholds', { ...DEFAULT_CUSTOM_THRESHOLDS, ...base });
    }
  };

  const handleOverrideToggle = (enabled: boolean) => {
    onPatch('override_enabled', enabled);
    if (enabled) {
      const base = profiles.find(p => p.key === form.profile)?.thresholds;
      if (base) onPatch('custom_thresholds', { ...DEFAULT_CUSTOM_THRESHOLDS, ...base });
    }
  };

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

            <SectionHeader title="Trading Mode" colors={colors} />
            <View style={[styles.modeBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {(Object.entries(MODE_META) as [TradingMode, typeof MODE_META[TradingMode]][]).map(([mode, meta]) => {
                const active = form.mode === mode;
                return (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => onModeSelect(mode)}
                    activeOpacity={0.7}
                    style={[styles.modeBtn, active && { backgroundColor: meta.color + '1A', borderRadius: 10 }]}
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

            <SectionHeader title="Paired Strategy" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ConfigRow label="Linked Config" colors={colors} last={!pairOpen}>
                <TouchableOpacity
                  onPress={() => pairOptions.length > 0 && setPairOpen(o => !o)}
                  activeOpacity={0.7}
                  disabled={pairOptions.length === 0}
                  style={[styles.tickerSelect, { backgroundColor: colors.border, borderColor: colors.border }]}
                >
                  <Text style={[styles.tickerSelectText, { color: colors.text }]} numberOfLines={1}>
                    {form.paired_strategy_id
                      ? (pairOptions.find(o => o.id === form.paired_strategy_id)?.strategy_name || 'Linked')
                      : (pairOptions.length > 0 ? 'None' : 'No match')}
                  </Text>
                  {pairOptions.length > 0 && (
                    <Ionicons name={pairOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.tabBarInactive} />
                  )}
                </TouchableOpacity>
              </ConfigRow>

              {pairOpen && (
                <View style={[styles.tickerMenu, { borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    onPress={() => { onPatch('paired_strategy_id', null); setPairOpen(false); }}
                    activeOpacity={0.7}
                    style={[styles.tickerMenuItem, form.paired_strategy_id === null && { backgroundColor: colors.accent + '1A' }]}
                  >
                    <Text style={[styles.tickerMenuItemText, { color: form.paired_strategy_id === null ? colors.accent : colors.text, fontWeight: form.paired_strategy_id === null ? '700' : '500' }]}>
                      None
                    </Text>
                    {form.paired_strategy_id === null && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                  </TouchableOpacity>
                  {pairOptions.map(opt => {
                    const selected = form.paired_strategy_id === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => { onPatch('paired_strategy_id', opt.id); setPairOpen(false); }}
                        activeOpacity={0.7}
                        style={[styles.tickerMenuItem, selected && { backgroundColor: colors.accent + '1A' }]}
                      >
                        <Text style={[styles.tickerMenuItemText, { color: selected ? colors.accent : colors.text, fontWeight: selected ? '700' : '500' }]}>
                          {opt.strategy_name || `${opt.ticker} ${opt.profile}`} ({opt.paper_mode ? 'Paper' : 'Live'})
                        </Text>
                        {selected && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
            <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
              {pairOptions.length > 0
                ? 'Linking a paper and live config for the same signal means neither one pauses for confirmation when the other takes the same trade — they mirror each other intentionally instead of being treated as a conflict.'
                : `No opposite-mode ${form.ticker} strategy exists yet to pair with.`}
            </Text>

            <SectionHeader title="Configuration" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ConfigRow label="Ticker" colors={colors}>
                <TouchableOpacity
                  onPress={() => setTickerOpen(o => !o)}
                  activeOpacity={0.7}
                  style={[styles.tickerSelect, { backgroundColor: colors.border, borderColor: colors.border }]}
                >
                  <Text style={[styles.tickerSelectText, { color: colors.text }]}>{form.ticker}</Text>
                  <Ionicons name={tickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.tabBarInactive} />
                </TouchableOpacity>
              </ConfigRow>

              {tickerOpen && (
                <View style={[styles.tickerMenu, { borderTopColor: colors.border }]}>
                  {tickerOptions.map(t => {
                    const selected = form.ticker === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        onPress={() => { onPatch('ticker', t); setTickerOpen(false); }}
                        activeOpacity={0.7}
                        style={[styles.tickerMenuItem, selected && { backgroundColor: colors.accent + '1A' }]}
                      >
                        <Text style={[styles.tickerMenuItemText, { color: selected ? colors.accent : colors.text, fontWeight: selected ? '700' : '500' }]}>
                          {t}
                        </Text>
                        {selected && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <ConfigRow label="Trade Days" colors={colors} last>
                <TradeDaysSelector selected={form.trade_days} onChange={days => onPatch('trade_days', days)} />
              </ConfigRow>
            </View>

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
                {([['ask < $1.00', '4 contracts'], ['$1.00 – $1.49', '2 contracts'], ['ask ≥ $1.50', '1 contract']] as [string, string][]).map(([range, qty], i, arr) => (
                  <View key={range} style={[styles.configRow, i < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, { borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                    <Text style={[styles.configLabel, { color: colors.tabBarInactive, fontSize: 13 }]}>{range}</Text>
                    <Text style={[styles.configLabel, { color: colors.text, fontWeight: '700', fontSize: 13 }]}>{qty}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={[styles.hint, { color: colors.tabBarInactive }]}>
              Capital limit and buying power checks still apply after smart sizing.
            </Text>

            <SectionHeader title="Budget OTM Mode" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.configRow, form.budget_otm_mode ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : { borderBottomWidth: 0 }]}>
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
                    Strike is anchored to a Fibonacci extension of the ORB range.
                  </Text>
                  <View style={styles.fibChipRow}>
                    {(['1.0', '1.618', '2.618'] as OtmFibLevel[]).map(level => {
                      const selected = form.otm_fib_level === level;
                      return (
                        <TouchableOpacity
                          key={level}
                          onPress={() => onPatch('otm_fib_level', level)}
                          activeOpacity={0.7}
                          style={[styles.fibChip, selected ? { borderColor: '#4A9EFF', backgroundColor: '#4A9EFF22' } : { borderColor: colors.border, backgroundColor: colors.background }]}
                        >
                          <Text style={[styles.fibChipLabel, { color: selected ? '#4A9EFF' : colors.text }]}>{level}×</Text>
                          <Text style={[styles.fibChipSub, { color: selected ? '#4A9EFF' : colors.tabBarInactive }]}>Fib</Text>
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

            <SectionHeader title="Breakout Window" colors={colors} />
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.configRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
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

              <View style={[styles.configRow, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.configLabel, { color: colors.text }]}>Confirm Before Entry</Text>
                  <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>
                    {form.confirm_entry
                      ? 'Pause and ask before every auto entry — Enter or Skip from the app'
                      : 'Enter automatically the moment a signal is confirmed'}
                  </Text>
                </View>
                <Switch
                  value={form.confirm_entry}
                  onValueChange={v => onPatch('confirm_entry', v)}
                  thumbColor={form.confirm_entry ? '#30D158' : '#ccc'}
                  trackColor={{ true: '#30D15855', false: colors.border }}
                />
              </View>
            </View>

            <SectionHeader title="Trading Profile" colors={colors} />
            {profiles.filter(p => PRIMARY_PROFILES.includes(p.key))
              .sort((a, b) => PRIMARY_PROFILES.indexOf(a.key) - PRIMARY_PROFILES.indexOf(b.key))
              .map(p => (
                <ProfileCard key={p.key} profile={p} selected={form.profile === p.key} onSelect={handleProfileSelect} />
              ))}

            <TouchableOpacity
              onPress={() => setShowMoreProfiles(v => !v)}
              activeOpacity={0.7}
              style={[styles.moreProfilesBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.moreProfilesBtnText, { color: colors.tabBarInactive }]}>
                {showMoreProfiles ? 'Fewer profiles' : 'More profiles'}
              </Text>
              <Ionicons name={showMoreProfiles ? 'chevron-up' : 'chevron-down'} size={14} color={colors.tabBarInactive} />
            </TouchableOpacity>

            {showMoreProfiles && (
              <>
                {profiles.filter(p => SECONDARY_PROFILES.includes(p.key))
                  .sort((a, b) => SECONDARY_PROFILES.indexOf(a.key) - SECONDARY_PROFILES.indexOf(b.key))
                  .map(p => (
                    <ProfileCard key={p.key} profile={p} selected={form.profile === p.key} onSelect={handleProfileSelect} />
                  ))}

                <TouchableOpacity
                  onPress={() => onPatch('profile', 'CUSTOM')}
                  activeOpacity={0.8}
                  style={[styles.customProfileCard, { backgroundColor: colors.card, borderColor: form.profile === 'CUSTOM' ? '#A855F7' : colors.border, borderWidth: form.profile === 'CUSTOM' ? 2 : 1 }]}
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

            {form.profile !== 'CUSTOM' && (
              <>
                <SectionHeader title="Override Defaults" colors={colors} />
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.configRow, { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.configLabel, { color: colors.text }]}>Customize This Strategy</Text>
                      <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>
                        Keep {profiles.find(p => p.key === form.profile)?.display_name ?? form.profile}'s entry/exit logic, but set your own contracts, TP1/TP2, and stop-loss for this strategy only
                      </Text>
                    </View>
                    <Switch
                      value={form.override_enabled}
                      onValueChange={handleOverrideToggle}
                      thumbColor={form.override_enabled ? '#30D158' : '#ccc'}
                      trackColor={{ true: '#30D15855', false: colors.border }}
                    />
                  </View>
                </View>
              </>
            )}

            {(form.profile === 'CUSTOM' || form.override_enabled) && (
              <CustomThresholdsEditor
                thresholds={form.custom_thresholds}
                onChange={t => onPatch('custom_thresholds', t)}
                colors={colors}
                onDragStart={() => setScrollEnabled(false)}
                onDragEnd={() => setScrollEnabled(true)}
              />
            )}

            {form.profile !== 'CUSTOM' && !form.override_enabled && (
              <>
                <SectionHeader title="Exit Controls" colors={colors} />
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.configRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.configLabel, { color: colors.text }]}>Consolidation Exit</Text>
                      <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>Close when price stops moving after 5 min</Text>
                    </View>
                    <Switch value={form.consol_exit} onValueChange={v => onPatch('consol_exit', v)} thumbColor={form.consol_exit ? '#4A9EFF' : '#ccc'} trackColor={{ true: '#4A9EFF55', false: colors.border }} />
                  </View>
                  <View style={[styles.configRow, { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.configLabel, { color: colors.text }]}>Volume Exit</Text>
                      <Text style={[styles.hint, { marginTop: 2, marginBottom: 0, color: colors.tabBarInactive }]}>Close half position on low volume after 3 min</Text>
                    </View>
                    <Switch value={form.volume_exit} onValueChange={v => onPatch('volume_exit', v)} thumbColor={form.volume_exit ? '#4A9EFF' : '#ccc'} trackColor={{ true: '#4A9EFF55', false: colors.border }} />
                  </View>
                </View>
                <Text style={[styles.hint, { color: colors.tabBarInactive }]}>Both are off by default.</Text>
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

const OTM_GUIDE: Record<OtmFibLevel, { risk: string; riskColor: string; delta: string; premium: string; stop: string; atmAt: string; typicalWin: string; bigMove: string; desc: string }> = {
  '1.0':   { risk: 'Medium',    riskColor: '#FF9F0A', delta: '0.14 – 0.26', premium: '$0.20 – $0.60', stop: '45%', atmAt: 'TP1 zone  (1× ORB range)',       typicalWin: '+80 – 120%',   bigMove: '+250%+', desc: 'Nearest budget strike. Reacts meaningfully to a standard TP1-sized move.' },
  '1.618': { risk: 'High',      riskColor: '#FF6B35', delta: '0.08 – 0.17', premium: '$0.08 – $0.25', stop: '55%', atmAt: 'TP2 zone  (1.618× ORB range)',    typicalWin: '+120 – 200%',  bigMove: '+500%+', desc: 'Golden ratio extension. Cheap premium with a large % gain if TP2 is hit.' },
  '2.618': { risk: 'Very High', riskColor: '#FF453A', delta: '0.03 – 0.09', premium: '$0.03 – $0.10', stop: '65%', atmAt: 'Beyond TP2  (2.618× ORB range)', typicalWin: '+200 – 400%',  bigMove: '+1000%+', desc: 'Very deep OTM. Near-zero delta; requires a strong breakout to pay off.' },
};

function OtmRiskGuide({ level, colors }: { level: OtmFibLevel; colors: any }) {
  const g = OTM_GUIDE[level];
  const rows: [string, string][] = [['Delta range', g.delta], ['Est. premium', g.premium], ['Hard stop', g.stop], ['Near ATM at', g.atmAt], ['Typical winner', g.typicalWin], ['Big move', g.bigMove]];
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

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 8 },
  sectionAccentDot: { width: 7, height: 7, borderRadius: 4 },
  sectionHeader:    { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: '#888' },

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

  // ── Live position panel ──
  livePnlCard:    { marginTop: 10, borderRadius: 10, borderWidth: 1, padding: 10 },

  liveHeaderRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  liveHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveHeaderRight:{ alignItems: 'flex-end', gap: 3 },
  liveLabel:      { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  liveContract:   { fontSize: 10, color: '#888' },

  livePnlValue:   { fontSize: 18, fontWeight: '700' },
  pnlPctPill:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pnlPctText:     { fontSize: 11, fontWeight: '700' },
  mktValText:     { fontSize: 10, fontWeight: '600', marginTop: 2 },

  liveStats:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  liveStat:       { alignItems: 'center', flex: 1 },
  liveStatLabel:  { fontSize: 10, marginBottom: 2 },
  liveStatValue:  { fontSize: 13, fontWeight: '700' },

  stopBar:   { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 4 },
  stopStage: { alignItems: 'center', flex: 1 },
  stopDot:   { width: 8, height: 8, borderRadius: 4, marginBottom: 3 },
  stopLabel: { fontSize: 10, fontWeight: '600' },
  stopValue: { fontSize: 9, marginTop: 2 },

  tpRow:     { flexDirection: 'row', gap: 6, marginTop: 8 },
  tpBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tpBadgeText: { fontSize: 11, fontWeight: '700' },

  exitBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 9, borderRadius: 9, borderWidth: 1 },
  exitBtnText: { fontSize: 13, fontWeight: '700' },
  liveActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },

  liveDetail:          { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  liveDetailRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveDetailLabel:     { fontSize: 12, fontWeight: '500' },
  liveDetailRight:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDetailValue:     { fontSize: 13, fontWeight: '700' },
  liveDetailBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  liveDetailBadgeText: { fontSize: 10, fontWeight: '700' },

  closedDetails: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },

  stratActions: { justifyContent: 'center', gap: 12, paddingHorizontal: 10 },
  actionBtn:    { padding: 4 },

  emptyCard:    { alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 32, gap: 8, marginBottom: 12 },
  emptyText:    { fontSize: 15, fontWeight: '600' },
  emptySubtext: { fontSize: 13 },

  moreProfilesBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginBottom: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  moreProfilesBtnText: { fontSize: 13, fontWeight: '500' },

  customProfileCard: { borderRadius: 14, padding: 14, marginBottom: 12, position: 'relative' },
  customActiveBadge: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  customProfileEmoji: { fontSize: 28, marginBottom: 4 },
  customProfileName:  { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  customProfileSub:   { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  customProfileDesc:  { fontSize: 12, lineHeight: 17 },

  budgetBody:   { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 8 },
  fibChipRow:   { flexDirection: 'row', gap: 8, marginBottom: 4 },
  fibChip:      { flex: 1, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  fibChipLabel: { fontSize: 16, fontWeight: '700' },
  fibChipSub:   { fontSize: 10, fontWeight: '500', marginTop: 1 },

  simBtn:      { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  simIconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  simBtnTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  simBtnSub:   { fontSize: 12 },

  modalContainer: { flex: 1 },
  modalHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle:     { fontSize: 17, fontWeight: '600' },
  modalTabs:      { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  modalTabBtn:    { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
  modalTabText:   { fontSize: 13, fontWeight: '700' },
  modalCancel:    { fontSize: 15 },
  modalSave:      { fontSize: 15, fontWeight: '700' },
  modalContent:   { paddingHorizontal: 16, paddingTop: 8 },

  inputCard:     { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 4 },
  textInput:     { fontSize: 15, paddingVertical: 12 },
  capitalRow:    { flexDirection: 'row', alignItems: 'center' },
  capitalDollar: { fontSize: 15, marginRight: 4 },
  capitalInput:  { flex: 1, fontSize: 15, paddingVertical: 12 },
  hint:          { fontSize: 12, marginBottom: 4, marginTop: 2, marginHorizontal: 2 },

  modeBar:     { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 6, marginBottom: 8 },
  modeBtn:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 4, position: 'relative' },
  modeBtnText: { fontSize: 12 },

  card:       { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  configRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  configLabel: { fontSize: 14, fontWeight: '500' },
  chipRow:    { flexDirection: 'row', gap: 6 },
  chip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  chipText:   { fontSize: 13, fontWeight: '600' },

  tickerSelect:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, minWidth: 90, justifyContent: 'space-between' },
  tickerSelectText: { fontSize: 13, fontWeight: '700' },
  tickerMenu:       { borderTopWidth: StyleSheet.hairlineWidth },
  tickerMenuItem:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  tickerMenuItemText: { fontSize: 14 },
});
