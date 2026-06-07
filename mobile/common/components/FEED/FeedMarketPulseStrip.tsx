/**
 * FeedMarketPulseStrip
 *
 * Self-contained market-data strip for the Feed screen.
 * Long-press opens a config sheet to toggle which items are shown.
 * Config is persisted in SecureStore per device.
 *
 * Configurable items: VIX · SPY · QQQ · IWM · Flow
 * Default:            VIX · SPY · Flow
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, Modal, ScrollView,
  Switch, TouchableOpacity, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';

// ─── Types ────────────────────────────────────────────────────────────────────

type StripItemKey = 'VIX' | 'SPY' | 'QQQ' | 'IWM' | 'FLOW';

interface StripItemMeta {
  key:   StripItemKey;
  label: string;
  desc:  string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIG_KEY     = '@alethia/feed_pulse_strip_config';
const DEFAULT_CONFIG: StripItemKey[] = ['VIX', 'SPY', 'FLOW'];

const ALL_ITEMS: StripItemMeta[] = [
  { key: 'VIX',  label: 'VIX',  desc: 'CBOE Volatility Index'  },
  { key: 'SPY',  label: 'SPY',  desc: 'S&P 500 ETF'            },
  { key: 'QQQ',  label: 'QQQ',  desc: 'Nasdaq-100 ETF'         },
  { key: 'IWM',  label: 'IWM',  desc: 'Russell 2000 ETF'       },
  { key: 'FLOW', label: 'Flow', desc: 'ORB tracked-ticker flow' },
];

const SENTIMENT_HEX: Record<string, string> = {
  green:  '#30D158',
  gray:   '#8E8E93',
  yellow: '#FFD60A',
  orange: '#FF9F0A',
  red:    '#FF453A',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeFlow(orbData: any[], livePrices: Record<string, number>) {
  let up = 0, down = 0;
  for (const item of orbData) {
    const price = livePrices[item.ticker] ?? item.current_price;
    const ref   = item.opening_price ?? item.previous_close;
    if (price == null || ref == null || ref === 0) continue;
    price > ref ? up++ : down++;
  }
  if (up + down === 0) return { label: 'No Data', up: 0, down: 0, color: '#8E8E93' };
  const label = up > down ? 'Bullish' : down > up ? 'Bearish' : 'Mixed';
  const color = label === 'Bullish' ? '#30D158' : label === 'Bearish' ? '#FF453A' : '#8E8E93';
  return { label, up, down, color };
}

async function loadConfig(): Promise<StripItemKey[]> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as StripItemKey[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_CONFIG;
}

async function saveConfig(cfg: StripItemKey[]) {
  try {
    await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(cfg));
  } catch {}
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({
  label, value, sub, accentColor, colors,
}: {
  label: string;
  value: string;
  sub?: string;
  accentColor: string;
  colors: any;
}) {
  return (
    <View style={{
      backgroundColor: accentColor + '14',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: accentColor + '30',
      paddingHorizontal: 10,
      paddingVertical: 7,
      minWidth: 72,
      marginRight: 6,
    }}>
      <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>
        {label}
      </Text>
      <Text style={{ color: accentColor, fontSize: 18, fontWeight: '800', letterSpacing: -0.5 }} numberOfLines={1}>
        {value}
      </Text>
      {sub != null && (
        <Text style={{ color: accentColor + 'CC', fontSize: 10, fontWeight: '600', marginTop: 1 }} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}

// ─── Config Sheet ─────────────────────────────────────────────────────────────

function ConfigSheet({
  visible,
  current,
  onClose,
  onSave,
  colors,
}: {
  visible:  boolean;
  current:  StripItemKey[];
  onClose:  () => void;
  onSave:   (cfg: StripItemKey[]) => void;
  colors:   any;
}) {
  const [draft, setDraft] = useState<StripItemKey[]>(current);

  useEffect(() => {
    if (visible) setDraft(current);
  }, [visible, current]);

  const toggle = (key: StripItemKey) => {
    if (draft.includes(key)) {
      // Always keep at least one item active
      if (draft.length <= 1) return;
      setDraft(prev => prev.filter(k => k !== key));
    } else {
      setDraft(prev => [...prev, key]);
    }
  };

  // Preserve the canonical ordering (ALL_ITEMS order)
  const ordered = ALL_ITEMS.map(i => i.key).filter(k => draft.includes(k));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        {/* Sheet — stop press propagation so tapping inside doesn't close */}
        <Pressable onPress={e => e.stopPropagation()}>
          <View style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingBottom: Platform.OS === 'ios' ? 36 : 24,
          }}>
            {/* Handle */}
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            {/* Title */}
            <View style={{ paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 }}>
                Customize Market Strip
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={{ height: 1, backgroundColor: colors.separator, marginBottom: 4 }} />

            {/* Toggle rows */}
            {ALL_ITEMS.map(item => {
              const enabled    = draft.includes(item.key);
              const isLastOne  = enabled && draft.length <= 1;
              return (
                <View
                  key={item.key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 20,
                    paddingVertical: 13,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.separator,
                    opacity: isLastOne ? 0.5 : 1,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>
                      {item.label}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
                      {item.desc}
                    </Text>
                  </View>
                  <Switch
                    value={enabled}
                    onValueChange={() => toggle(item.key)}
                    disabled={isLastOne}
                    trackColor={{ false: colors.border, true: colors.accent + '80' }}
                    thumbColor={enabled ? colors.accent : colors.textTertiary}
                    ios_backgroundColor={colors.border}
                  />
                </View>
              );
            })}

            {/* Save */}
            <TouchableOpacity
              onPress={() => { onSave(ordered); onClose(); }}
              style={{
                margin: 20,
                backgroundColor: colors.accent,
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FeedMarketPulseStrip() {
  const colors = useThemeColors();
  const [config, setConfig]         = useState<StripItemKey[]>(DEFAULT_CONFIG);
  const [sheetVisible, setSheet]    = useState(false);
  const configRef                   = useRef<StripItemKey[]>(DEFAULT_CONFIG);

  // Load persisted config on mount
  useEffect(() => {
    loadConfig().then(cfg => { setConfig(cfg); configRef.current = cfg; });
  }, []);

  // Extra price tickers needed for QQQ / IWM when enabled
  const extraTickers = useMemo(
    () => (['QQQ', 'IWM'] as const).filter(t => config.includes(t)),
    [config],
  );

  const { data: orbData } = useORBMonitoringState(false, false);
  const { livePrices, vix, spy, sentiment, connected } = useMarketStream(extraTickers);

  const sentimentColor = sentiment ? (SENTIMENT_HEX[sentiment.color] ?? colors.textSecondary) : colors.textSecondary;
  const flow = computeFlow(orbData ?? [], livePrices);

  const handleLongPress = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSheet(true);
  }, []);

  const handleSave = useCallback((newCfg: StripItemKey[]) => {
    setConfig(newCfg);
    configRef.current = newCfg;
    saveConfig(newCfg);
  }, []);

  return (
    <>
      <Pressable
        onLongPress={handleLongPress}
        delayLongPress={400}
        style={{
          marginHorizontal: 20,
          marginBottom: 8,
          backgroundColor: colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        {/* Header row */}
        <View style={{
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>
            Market Pulse
          </Text>
          {/* Live dot */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: connected ? '#30D158' : colors.textTertiary,
            }} />
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600' }}>
              {connected ? 'LIVE' : 'OFF'}
            </Text>
          </View>
          {/* Long-press hint */}
          <Ionicons name="ellipsis-horizontal" size={14} color={colors.textTertiary} />
        </View>

        {/* Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={false}
          contentContainerStyle={{ paddingLeft: 14, paddingRight: 8, paddingBottom: 12 }}
        >
          {config.map(key => {
            switch (key) {
              case 'VIX':
                return (
                  <Pill
                    key="VIX"
                    label="VIX"
                    value={vix != null ? vix.toFixed(2) : '—'}
                    sub={sentiment?.label ?? '—'}
                    accentColor={sentimentColor}
                    colors={colors}
                  />
                );
              case 'SPY':
                return (
                  <Pill
                    key="SPY"
                    label="SPY"
                    value={spy != null ? `$${spy.toFixed(2)}` : '—'}
                    sub="S&P 500"
                    accentColor={colors.accent}
                    colors={colors}
                  />
                );
              case 'QQQ': {
                const qqq = livePrices['QQQ'];
                return (
                  <Pill
                    key="QQQ"
                    label="QQQ"
                    value={qqq != null ? `$${qqq.toFixed(2)}` : '—'}
                    sub="Nasdaq-100"
                    accentColor={colors.accent}
                    colors={colors}
                  />
                );
              }
              case 'IWM': {
                const iwm = livePrices['IWM'];
                return (
                  <Pill
                    key="IWM"
                    label="IWM"
                    value={iwm != null ? `$${iwm.toFixed(2)}` : '—'}
                    sub="Russell 2K"
                    accentColor={colors.accent}
                    colors={colors}
                  />
                );
              }
              case 'FLOW':
                return (
                  <Pill
                    key="FLOW"
                    label="Flow"
                    value={flow.label}
                    sub={flow.up + flow.down > 0 ? `${flow.up}↑ · ${flow.down}↓` : undefined}
                    accentColor={flow.color}
                    colors={colors}
                  />
                );
              default:
                return null;
            }
          })}
        </ScrollView>
      </Pressable>

      <ConfigSheet
        visible={sheetVisible}
        current={config}
        onClose={() => setSheet(false)}
        onSave={handleSave}
        colors={colors}
      />
    </>
  );
}
