/**
 * FeedMarketPulseStrip
 *
 * Configurable market-data strip for the Feed screen.
 * Long-press anywhere on the strip → bottom sheet to toggle visible items.
 *
 * Special items: VIX (volatility index + sentiment) · Flow (ORB ticker flow)
 * Price items:   Any ticker symbol — base set (SPY, QQQ, IWM) + every ticker
 *                currently tracked on the ORB screen
 *
 * Config is persisted to user_profiles.market_pulse_config (Supabase) so it
 * survives device switches / reinstalls. SecureStore is used as a local cache
 * for instant load on first render.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Platform, Pressable, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useORBMonitoringState } from '@/hooks/queries/orb/useORBMonitoringState';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useUpdateProfileMutation } from '@/hooks/mutations/auth/useUpdateProfileMutation';
import { StatPill } from '@/common/components/ui/StatPill';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIG_KEY = 'alethia.feed_pulse_strip_v2';

// Always-available base tickers (shown even without ORB monitoring)
const BASE_TICKERS = ['SPY', 'QQQ', 'IWM'];

// Default strip: VIX + SPY + Flow
const DEFAULT_CONFIG: string[] = ['VIX', 'SPY', 'FLOW'];

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

async function loadLocalConfig(): Promise<string[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return null;
}

async function cacheLocalConfig(cfg: string[]) {
  try { await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

// ─── Config Sheet ─────────────────────────────────────────────────────────────

function ConfigSheet({
  visible, draft, orbTickers, onToggle, onSave, onClose, colors,
}: {
  visible:    boolean;
  draft:      string[];
  orbTickers: string[];
  onToggle:   (key: string) => void;
  onSave:     () => void;
  onClose:    () => void;
  colors:     any;
}) {
  // Keep a minimum of 1 item active
  const canRemove = (key: string) => draft.length > 1 || !draft.includes(key);

  function ChipToggle({ itemKey, label }: { itemKey: string; label: string }) {
    const active     = draft.includes(itemKey);
    const removable  = canRemove(itemKey);

    return (
      <Pressable
        onPress={() => { if (!active || removable) onToggle(itemKey); }}
        style={({ pressed }) => ({
          width: '48%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 14,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: active ? colors.accent + '80' : colors.border,
          backgroundColor: active ? colors.accent + '12' : colors.surfaceSecondary,
          opacity: pressed ? 0.7 : 1,
          marginBottom: 10,
        })}
      >
        {active ? (
          <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
        ) : (
          <View style={{
            width: 18, height: 18, borderRadius: 9,
            borderWidth: 1.5, borderColor: colors.border,
          }} />
        )}
        <Text
          style={{ color: active ? colors.text : colors.textSecondary, fontWeight: '600', fontSize: 15 }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  const hasOrbTickers = orbTickers.length > 0;
  // All ticker options: base set + any ORB tickers not already in base
  const allTickers = [...new Set([...BASE_TICKERS, ...orbTickers])];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable onPress={e => e.stopPropagation()}>
          <View style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: Platform.OS === 'ios' ? 40 : 24,
            height: '82%',
          }}>
            {/* Handle */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            {/* Header */}
            <View style={{
              paddingHorizontal: 20, paddingVertical: 14,
              flexDirection: 'row', alignItems: 'center',
              borderBottomWidth: 1, borderBottomColor: colors.separator,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>
                  Customize Market Pulse
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                  Long-press the strip to re-open this menu
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  width: 30, height: 30, borderRadius: 15,
                  backgroundColor: colors.surfaceSecondary,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Section: Indicators */}
              <Text style={{
                color: colors.textTertiary, fontSize: 11, fontWeight: '700',
                textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
              }}>
                Indicators
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <ChipToggle itemKey="VIX"  label="VIX" />
                <ChipToggle itemKey="FLOW" label="Flow" />
              </View>

              {/* Section: Tickers */}
              <Text style={{
                color: colors.textTertiary, fontSize: 11, fontWeight: '700',
                textTransform: 'uppercase', letterSpacing: 0.8,
                marginTop: 8, marginBottom: 10,
              }}>
                Tickers
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {allTickers.map(ticker => (
                  <ChipToggle key={ticker} itemKey={ticker} label={ticker} />
                ))}
              </View>

              {!hasOrbTickers && (
                <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 4, marginBottom: 8 }}>
                  Add tickers to your ORB screen to see them here.
                </Text>
              )}
            </ScrollView>

            {/* Save */}
            <TouchableOpacity
              onPress={() => { onSave(); onClose(); }}
              style={{
                marginHorizontal: 20,
                marginTop: 4,
                backgroundColor: colors.accent,
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.accentForeground, fontSize: 15, fontWeight: '700' }}>
                Save Changes
              </Text>
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
  const { authState: { user, profile } } = useAuth();
  const updateProfile = useUpdateProfileMutation();

  const [config, setConfig]      = useState<string[]>(DEFAULT_CONFIG);
  const [draft, setDraft]        = useState<string[]>(DEFAULT_CONFIG);
  const [sheetVisible, setSheet] = useState(false);
  const configLoadedRef          = useRef(false);

  // Load config: profile (Supabase) takes priority, SecureStore is the local cache.
  // Profile is not available on first render (auth hydration), so we start with
  // SecureStore and upgrade once the profile arrives.
  useEffect(() => {
    if (configLoadedRef.current) return;

    if (profile) {
      // Profile loaded — use it as source of truth
      const remote = profile.market_pulse_config;
      if (Array.isArray(remote) && remote.length > 0) {
        setConfig(remote);
        setDraft(remote);
        cacheLocalConfig(remote); // keep local cache in sync
      } else {
        // Profile has no config yet — check local cache, then default
        loadLocalConfig().then(local => {
          const resolved = (local ?? DEFAULT_CONFIG);
          setConfig(resolved);
          setDraft(resolved);
        });
      }
      configLoadedRef.current = true;
    } else {
      // Profile not yet loaded — use local cache for instant display
      loadLocalConfig().then(local => {
        if (local) { setConfig(local); setDraft(local); }
      });
    }
  }, [profile]);

  // ORB tickers from monitoring state (excludes mock data)
  const { data: orbData } = useORBMonitoringState(false, false);
  const orbTickers = useMemo(
    () => [...new Set((orbData ?? []).map((d: any) => d.ticker as string))],
    [orbData],
  );

  // Tickers to subscribe to the live price stream:
  // - All non-special items in config (VIX and FLOW are not tickers)
  const streamTickers = useMemo(
    () => config.filter(k => k !== 'VIX' && k !== 'FLOW'),
    [config],
  );

  const { livePrices, vix, spy, sentiment, connected } = useMarketStream(streamTickers);
  const sentimentColor = sentiment
    ? (SENTIMENT_HEX[sentiment.color] ?? colors.textSecondary)
    : colors.textSecondary;
  const flow = computeFlow(orbData ?? [], livePrices);

  // ── ORB position lookup: O(1) by ticker ─────────────────────────────────
  const orbMap = useMemo(() => {
    const m = new Map<string, { high: number | null; low: number | null }>();
    for (const item of (orbData ?? [])) {
      m.set(item.ticker as string, {
        high: (item as any).orb_high ?? null,
        low:  (item as any).orb_low  ?? null,
      });
    }
    return m;
  }, [orbData]);

  const getOrbColor = useCallback((ticker: string, price: number | null): string => {
    const orb = orbMap.get(ticker);
    if (!orb || price == null || (orb.high == null && orb.low == null)) return colors.accent;
    if (orb.high != null && price > orb.high) return '#30D158'; // above range — green
    if (orb.low  != null && price < orb.low)  return '#FF453A'; // below range — red
    return '#FFD60A'; // inside range — yellow
  }, [orbMap, colors.accent]);

  const getOrbSub = useCallback((ticker: string, price: number | null): string | undefined => {
    const orb = orbMap.get(ticker);
    if (!orb || price == null || (orb.high == null && orb.low == null)) return undefined;
    if (orb.high != null && price > orb.high) return '↑ Above ORB';
    if (orb.low  != null && price < orb.low)  return '↓ Below ORB';
    return '◉ In Range';
  }, [orbMap]);

  // ── Config sheet ────────────────────────────────────────────────────────
  const openSheet = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDraft(config); // reset draft to committed config
    setSheet(true);
  }, [config]);

  const handleToggle = useCallback((key: string) => {
    setDraft(prev =>
      prev.includes(key)
        ? (prev.length > 1 ? prev.filter(k => k !== key) : prev)
        : [...prev, key],
    );
  }, []);

  const handleSave = useCallback(() => {
    setConfig(draft);
    cacheLocalConfig(draft);
    if (user?.id) {
      updateProfile.mutate({ id: user.id, market_pulse_config: draft });
    }
  }, [draft, user, updateProfile]);

  // ── Render pills ────────────────────────────────────────────────────────
  function renderPill(key: string) {
    if (key === 'VIX') {
      return (
        <StatPill
          key="VIX"
          label="VIX"
          value={vix != null ? vix.toFixed(2) : '—'}
          sub={sentiment?.label ?? '—'}
          accentColor={sentimentColor}
          colors={colors}
        />
      );
    }
    if (key === 'FLOW') {
      return (
        <StatPill
          key="FLOW"
          label="Flow"
          value={flow.label}
          sub={flow.up + flow.down > 0 ? `${flow.up}↑ · ${flow.down}↓` : undefined}
          accentColor={flow.color}
          colors={colors}
        />
      );
    }
    // Ticker pill — SPY comes from the dedicated `spy` field; everything else from livePrices
    const price = key === 'SPY' ? spy : (livePrices[key] ?? null);
    const orbColor = getOrbColor(key, price);
    const orbSub   = getOrbSub(key, price);
    return (
      <StatPill
        key={key}
        label={key}
        value={price != null ? `$${price.toFixed(2)}` : '—'}
        sub={orbSub}
        accentColor={orbColor}
        colors={colors}
      />
    );
  }

  return (
    <>
      <Pressable
        onLongPress={openSheet}
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
        {/* Header */}
        <View style={{
          paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6,
          flexDirection: 'row', alignItems: 'center', gap: 6,
        }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 }}>
            Market Pulse
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: connected ? '#30D158' : colors.textTertiary,
            }} />
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600' }}>
              {connected ? 'LIVE' : 'OFF'}
            </Text>
          </View>
          {/* Visual hint that long-press opens config */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 3,
            backgroundColor: colors.surfaceSecondary, borderRadius: 6,
            paddingHorizontal: 6, paddingVertical: 3,
          }}>
            <Ionicons name="settings-outline" size={10} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '600' }}>Hold</Text>
          </View>
        </View>

        {/* Pills row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled
          contentContainerStyle={{ paddingLeft: 14, paddingRight: 8, paddingBottom: 14 }}
        >
          {config.map(key => renderPill(key))}
        </ScrollView>
      </Pressable>

      <ConfigSheet
        visible={sheetVisible}
        draft={draft}
        orbTickers={orbTickers}
        onToggle={handleToggle}
        onSave={handleSave}
        onClose={() => setSheet(false)}
        colors={colors}
      />
    </>
  );
}
