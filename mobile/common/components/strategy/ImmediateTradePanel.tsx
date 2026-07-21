import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OptionsChainPicker } from '@/common/components/strategy/OptionsChainPicker';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { blendHex } from '@/lib/colorBlend';

interface Props {
  colors: any;
  tickerOptions: string[];
  visible: boolean;
  onClose?: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────
// Ticker selection lives here; everything past "which ticker" (expiration
// chips, the strike chain, order entry) is OptionsChainPicker, shared with
// the ticker detail screen's Contracts tab where the ticker is already fixed
// and this picker isn't needed at all.

export function ImmediateTradePanel({ colors, tickerOptions, visible, onClose }: Props) {
  const [ticker, setTicker]             = useState<string>('');
  const [searchOpen, setSearchOpen]     = useState(false);
  // Lifted up from OptionsChainPicker so the toggle can sit above the ticker
  // picker (per user request, after accidentally buying paper contracts
  // meant to be live) and so the same value drives one continuous background
  // tint across this screen, the chain screen, and the confirm modal —
  // rather than a small easy-to-glance-past pill being the only cue.
  const [paperMode, setPaperMode]       = useState(true);

  useEffect(() => {
    if (!ticker && tickerOptions.length) setTicker(tickerOptions[0]);
  }, [tickerOptions, ticker]);

  // Matches the app-wide paper/live convention used on Dashboard/Live
  // Positions/Trade Log — amber for paper, green for live.
  const modeTint = paperMode ? '#FF9F0A' : '#30D158';

  return (
    <View style={{ flex: 1, backgroundColor: blendHex(colors.background, modeTint, 0.08) }}>
      <View style={styles.controls}>
        {/* Paper / Live — above the ticker picker so it's the first thing
            tapped/seen, not something that can be scrolled past unnoticed. */}
        <Text style={[styles.controlLabel, { color: colors.tabBarInactive }]}>ACCOUNT</Text>
        <View style={[styles.accountToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {([['Paper', true], ['Live', false]] as const).map(([label, isPaper]) => {
            const active = paperMode === isPaper;
            const tint = isPaper ? '#FF9F0A' : '#30D158';
            return (
              <TouchableOpacity
                key={label}
                onPress={() => setPaperMode(isPaper)}
                activeOpacity={0.8}
                style={[styles.accountBtn, active && { backgroundColor: tint + '22', borderRadius: 8 }]}
              >
                <Text style={[styles.accountText, { color: active ? tint : colors.tabBarInactive, fontWeight: active ? '700' : '500' }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Ticker — a chip per ORB-monitored ticker plus a search button for
            anything else. The search button opens the same live-search sheet
            used everywhere else in the app (debounced auto-search, tap a
            result to select) instead of a bare text field the user had to
            type a full symbol into and then press a separate "go" button for
            — that extra press was the complaint this replaced. */}
        <Text style={[styles.controlLabel, { color: colors.tabBarInactive, marginTop: 4 }]}>TICKER</Text>
        <View style={styles.tickerRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {tickerOptions.map(t => {
                const active = ticker === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setTicker(t)}
                    activeOpacity={0.8}
                    style={[styles.tickerChip, { backgroundColor: active ? colors.accent + '22' : colors.card, borderColor: active ? colors.accent : colors.border }]}
                  >
                    <Text style={[styles.tickerChipText, { color: active ? colors.accent : colors.text }]}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
              {/* Custom ticker picked via search — shown as its own selected
                  chip since it won't be in tickerOptions. */}
              {!!ticker && !tickerOptions.includes(ticker) && (
                <View style={[styles.tickerChip, { backgroundColor: colors.accent + '22', borderColor: colors.accent }]}>
                  <Text style={[styles.tickerChipText, { color: colors.accent }]}>{ticker}</Text>
                </View>
              )}
            </View>
          </ScrollView>
          <TouchableOpacity
            onPress={() => setSearchOpen(true)}
            activeOpacity={0.7}
            style={[styles.tickerSearchToggle, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="search" size={16} color={colors.tabBarInactive} />
          </TouchableOpacity>
        </View>
      </View>

      <SearchBottomSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectTicker={t => setTicker(t)}
      />

      <OptionsChainPicker ticker={ticker} colors={colors} visible={visible} paperMode={paperMode} onChangePaperMode={setPaperMode} onSubmitted={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  controls:     { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  controlLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },

  accountToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, width: '100%' },
  accountBtn:    { flex: 1, alignItems: 'center', paddingVertical: 7 },
  accountText:   { fontSize: 13 },

  tickerRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tickerChip:        { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 100, borderWidth: 1 },
  tickerChipText:    { fontSize: 14, fontWeight: '700' },
  tickerSearchToggle:{ width: 36, height: 36, borderRadius: 100, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
