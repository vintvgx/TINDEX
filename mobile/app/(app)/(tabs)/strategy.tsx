import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useStrategyConfig } from '@/hooks/queries/strategy/useStrategyConfig';
import { useStrategyProfiles } from '@/hooks/queries/strategy/useStrategyProfiles';
import { useAlpacaAccount } from '@/hooks/queries/strategy/useAlpacaAccount';
import { useUpdateStrategyConfig } from '@/hooks/mutations/strategy/useUpdateStrategyConfig';
import { ProfileCard } from '@/common/components/strategy/ProfileCard';
import { TradeDaysSelector } from '@/common/components/strategy/TradeDaysSelector';
import type { StrategyConfig, ProfileKey } from '@/common/types/strategy';

const TICKERS     = ['SPY', 'QQQ', 'IWM'];
const ORB_MINUTES = [5, 10, 15] as const;

type TradingMode = 'paper' | 'live' | 'off';

function getMode(config: StrategyConfig): TradingMode {
  if (!config.active) return 'off';
  return config.paper_mode ? 'paper' : 'live';
}

const MODE_META: Record<TradingMode, { label: string; icon: string; color: string }> = {
  paper: { label: 'Paper',  icon: 'document-text-outline', color: '#FF9F0A' },
  live:  { label: 'Live',   icon: 'flash-outline',         color: '#30D158' },
  off:   { label: 'Off',    icon: 'power-outline',         color: '#FF453A' },
};

export default function StrategyScreen() {
  const colors  = useThemeColors();
  const toast   = useToast();

  const { data: config,   isLoading: configLoading  } = useStrategyConfig();
  const { data: profiles, isLoading: profilesLoading } = useStrategyProfiles();
  const { data: account } = useAlpacaAccount(!!config);
  const { mutate: updateConfig, isPending: saving } = useUpdateStrategyConfig();

  const [localConfig, setLocalConfig] = useState<Partial<StrategyConfig>>({});
  const [dirty, setDirty]             = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);

  useEffect(() => {
    if (config && !dirty) setLocalConfig(config);
  }, [config]);

  const merged = { ...config, ...localConfig } as StrategyConfig;

  const patch = <K extends keyof StrategyConfig>(key: K, val: StrategyConfig[K]) => {
    setLocalConfig(prev => ({ ...prev, [key]: val }));
    setDirty(true);
  };

  const handleSave = () => {
    updateConfig(localConfig, {
      onSuccess: () => { toast.success('Strategy saved'); setDirty(false); },
      onError:   () => toast.error('Failed to save strategy'),
    });
  };

  const handleProfileSelect = (key: ProfileKey) => {
    updateConfig({ profile: key }, {
      onSuccess: () => toast.success(`Profile switched to ${key.replace('_', ' ')}`),
      onError:   () => toast.error('Failed to update profile'),
    });
  };

  const applyMode = (newMode: TradingMode) => {
    const modeConfig: Partial<StrategyConfig> =
      newMode === 'off'  ? { active: false } :
      newMode === 'live' ? { paper_mode: false, active: true } :
                           { paper_mode: true,  active: true };

    // Optimistic visual update
    setLocalConfig(prev => ({ ...prev, ...modeConfig }));

    setSwitchingMode(true);
    updateConfig(modeConfig, {
      onSuccess: () => {
        const labels = { paper: 'Paper mode active', live: 'Live trading active', off: 'Trading disabled' };
        toast.success(labels[newMode]);
      },
      onError: () => {
        // Revert optimistic update
        setLocalConfig(prev => {
          const copy = { ...prev };
          (Object.keys(modeConfig) as Array<keyof StrategyConfig>).forEach(k => delete copy[k]);
          return copy;
        });
        toast.error('Failed to update trading mode');
      },
      onSettled: () => setSwitchingMode(false),
    });
  };

  const handleModePress = (newMode: TradingMode) => {
    if (newMode === getMode(merged)) return;   // no-op if already selected

    if (newMode === 'live') {
      Alert.alert(
        'Switch to Live Trading',
        'All future orders will use REAL MONEY.\n\nMake sure you have reviewed your position limits before proceeding.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch to Live', style: 'destructive', onPress: () => applyMode('live') },
        ]
      );
    } else {
      applyMode(newMode);
    }
  };

  if (configLoading || profilesLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const currentMode = getMode(merged);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>ORB Strategy</Text>
          <View style={{ width: 22 }} />
        </View>

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
              <Text style={[styles.pnlToday, {
                color: account.pnl_today >= 0 ? colors.success : colors.error,
              }]}>
                {account.pnl_today >= 0 ? '+' : ''}${account.pnl_today.toFixed(2)}
              </Text>
              <Text style={[styles.pnlPctToday, {
                color: account.pnl_today >= 0 ? colors.success : colors.error,
              }]}>
                {account.pnl_today_pct.toFixed(2)}% today
              </Text>
            </View>
          </View>
        )}

        {/* ── Trading Mode ─────────────────────────────────────────── */}
        <SectionHeader title="Trading Mode" colors={colors} />

        <View style={[styles.modeBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(Object.entries(MODE_META) as [TradingMode, typeof MODE_META[TradingMode]][]).map(([mode, meta]) => {
            const active = currentMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                onPress={() => handleModePress(mode)}
                disabled={switchingMode}
                activeOpacity={0.7}
                style={[
                  styles.modeBtn,
                  active && { backgroundColor: meta.color + '1A', borderRadius: 10 },
                ]}
              >
                {switchingMode && active
                  ? <ActivityIndicator size="small" color={meta.color} />
                  : <Ionicons name={meta.icon as any} size={18} color={active ? meta.color : colors.tabBarInactive} />
                }
                <Text style={[
                  styles.modeBtnText,
                  { color: active ? meta.color : colors.tabBarInactive,
                    fontWeight: active ? '700' : '500' },
                ]}>
                  {meta.label}
                </Text>
                {active && <View style={[styles.modeDot, { backgroundColor: meta.color }]} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {currentMode === 'off' && (
          <View style={[styles.offBanner, { borderColor: colors.error + '44', backgroundColor: colors.error + '0D' }]}>
            <Ionicons name="warning-outline" size={14} color={colors.error} style={{ marginRight: 6 }} />
            <Text style={[styles.offBannerText, { color: colors.error }]}>
              Strategy is disabled — no trades will be taken until you switch to Paper or Live.
            </Text>
          </View>
        )}

        {/* ── Configuration ─────────────────────────────────────────── */}
        <SectionHeader title="Configuration" colors={colors} />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Ticker */}
          <ConfigRow label="Ticker" colors={colors}>
            <View style={styles.chipRow}>
              {TICKERS.map(t => (
                <TouchableOpacity
                  key={t}
                  onPress={() => patch('ticker', t)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: merged.ticker === t ? colors.accent : colors.border,
                      borderColor: merged.ticker === t ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: merged.ticker === t ? '#fff' : colors.text }]}>
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
                  onPress={() => patch('orb_minutes', m)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: merged.orb_minutes === m ? colors.accent : colors.border,
                      borderColor: merged.orb_minutes === m ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: merged.orb_minutes === m ? '#fff' : colors.text }]}>
                    {m}m
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ConfigRow>

          {/* Trade days */}
          <ConfigRow label="Trade Days" colors={colors} last>
            <TradeDaysSelector
              selected={merged.trade_days ?? [0, 2, 4]}
              onChange={days => patch('trade_days', days)}
            />
          </ConfigRow>
        </View>

        {/* Save button */}
        {dirty && (
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={[styles.saveBtn, { backgroundColor: colors.accent }]}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.saveBtnText}>Save Configuration</Text>
            }
          </TouchableOpacity>
        )}

        {/* Profile picker */}
        <SectionHeader title="Trading Profile" colors={colors} />
        {profiles?.map(p => (
          <ProfileCard
            key={p.key}
            profile={p}
            selected={merged.profile === p.key}
            onSelect={handleProfileSelect}
          />
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const SectionHeader = ({ title, colors }: { title: string; colors: any }) => (
  <Text style={[styles.sectionHeader, { color: colors.tabBarInactive }]}>{title}</Text>
);

const ConfigRow = ({ label, colors, children, last }: any) => (
  <View style={[styles.configRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
    <Text style={[styles.configLabel, { color: colors.text }]}>{label}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  container:    { flex: 1 },
  content:      { paddingHorizontal: 16, paddingTop: 8 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title:        { fontSize: 20, fontWeight: '700' },

  accountCard:   { flexDirection: 'row', justifyContent: 'space-between', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  accountLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  accountEquity: { fontSize: 22, fontWeight: '700' },
  pnlCol:        { alignItems: 'flex-end', justifyContent: 'center' },
  pnlToday:      { fontSize: 16, fontWeight: '700' },
  pnlPctToday:   { fontSize: 12, fontWeight: '500', marginTop: 2 },

  modeBar:  {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    padding: 6,
    marginBottom: 8,
  },
  modeBtn:  {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 4,
    position: 'relative',
  },
  modeBtnText:  { fontSize: 12, fontWeight: '500' },
  modeDot:      {
    position: 'absolute',
    top: 6,
    right: 10,
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  offBanner:     { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 4 },
  offBannerText: { fontSize: 12, flex: 1, lineHeight: 17 },

  sectionHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  card:          { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  configRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  configLabel:   { fontSize: 14, fontWeight: '500' },
  chipRow:       { flexDirection: 'row', gap: 6 },
  chip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  chipText:      { fontSize: 13, fontWeight: '600' },
  saveBtn:       { borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  saveBtnText:   { color: '#fff', fontSize: 15, fontWeight: '700' },
});
