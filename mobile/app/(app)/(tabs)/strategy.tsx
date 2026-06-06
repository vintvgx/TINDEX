import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity,
  Switch, StyleSheet, ActivityIndicator,
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

const TICKERS = ['SPY', 'QQQ', 'IWM'];
const ORB_MINUTES = [5, 10, 15] as const;

export default function StrategyScreen() {
  const colors  = useThemeColors();
  const toast   = useToast();

  const { data: config,   isLoading: configLoading  } = useStrategyConfig();
  const { data: profiles, isLoading: profilesLoading } = useStrategyProfiles();
  const { data: account } = useAlpacaAccount(!!config);
  const { mutate: updateConfig, isPending: saving } = useUpdateStrategyConfig();

  const [localConfig, setLocalConfig] = useState<Partial<StrategyConfig>>({});
  const [dirty, setDirty] = useState(false);

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

  if (configLoading || profilesLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

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

        {/* Config section */}
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
          <ConfigRow label="Trade Days" colors={colors}>
            <TradeDaysSelector
              selected={merged.trade_days ?? [0, 2, 4]}
              onChange={days => patch('trade_days', days)}
            />
          </ConfigRow>

          {/* Paper mode */}
          <ConfigRow label="Paper Trading" colors={colors} last>
            <Switch
              value={merged.paper_mode ?? true}
              onValueChange={v => patch('paper_mode', v)}
              trackColor={{ false: colors.error, true: colors.success }}
            />
          </ConfigRow>
        </View>

        {/* Strategy active toggle */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ConfigRow label="Strategy Active" colors={colors} last>
            <Switch
              value={merged.active ?? true}
              onValueChange={v => patch('active', v)}
              trackColor={{ false: colors.border, true: colors.accent }}
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
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 8 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title:     { fontSize: 20, fontWeight: '700' },
  accountCard: { flexDirection: 'row', justifyContent: 'space-between', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  accountLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  accountEquity: { fontSize: 22, fontWeight: '700' },
  pnlCol: { alignItems: 'flex-end', justifyContent: 'center' },
  pnlToday: { fontSize: 16, fontWeight: '700' },
  pnlPctToday: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  sectionHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  configRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  configLabel: { fontSize: 14, fontWeight: '500' },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },
  saveBtn: { borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
