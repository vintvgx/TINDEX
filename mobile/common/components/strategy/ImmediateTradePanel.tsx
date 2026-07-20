import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OptionsChainPicker } from '@/common/components/strategy/OptionsChainPicker';

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
  const [tickerSearchOpen, setTickerSearchOpen] = useState(false);
  const [tickerInput, setTickerInput]   = useState('');

  useEffect(() => {
    if (!ticker && tickerOptions.length) setTicker(tickerOptions[0]);
  }, [tickerOptions, ticker]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.controls}>
        {/* Ticker — a chip per ORB-monitored ticker plus a search toggle for
            anything else, in place of the old open/close accordion menu. */}
        <Text style={[styles.controlLabel, { color: colors.tabBarInactive }]}>TICKER</Text>
        <View style={styles.tickerRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {tickerOptions.map(t => {
                const active = ticker === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => { setTicker(t); setTickerSearchOpen(false); }}
                    activeOpacity={0.8}
                    style={[styles.tickerChip, { backgroundColor: active ? colors.accent + '22' : colors.card, borderColor: active ? colors.accent : colors.border }]}
                  >
                    <Text style={[styles.tickerChipText, { color: active ? colors.accent : colors.text }]}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
              {/* Custom ticker entered via search — shown as its own selected
                  chip once picked, since it won't be in tickerOptions. */}
              {!!ticker && !tickerOptions.includes(ticker) && (
                <View style={[styles.tickerChip, { backgroundColor: colors.accent + '22', borderColor: colors.accent }]}>
                  <Text style={[styles.tickerChipText, { color: colors.accent }]}>{ticker}</Text>
                </View>
              )}
            </View>
          </ScrollView>
          <TouchableOpacity
            onPress={() => setTickerSearchOpen(o => !o)}
            activeOpacity={0.7}
            style={[styles.tickerSearchToggle, { backgroundColor: tickerSearchOpen ? colors.accent + '22' : colors.card, borderColor: tickerSearchOpen ? colors.accent : colors.border }]}
          >
            <Ionicons name="search" size={16} color={tickerSearchOpen ? colors.accent : colors.tabBarInactive} />
          </TouchableOpacity>
        </View>

        {/* Free-text entry — tickerOptions only lists ORB-monitored tickers
            (effectively SPY/QQQ/IWM today), so this is the only way to reach
            any other stock. Same 1-5 alpha validation the backend applies. */}
        {tickerSearchOpen && (
          <View style={styles.tickerSearchRow}>
            <TextInput
              value={tickerInput}
              onChangeText={t => setTickerInput(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))}
              placeholder="Type any ticker (e.g. AAPL)"
              placeholderTextColor={colors.tabBarInactive}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              style={[styles.tickerSearchInput, { color: colors.text, borderColor: colors.border }]}
              onSubmitEditing={() => {
                if (!tickerInput) return;
                setTicker(tickerInput);
                setTickerSearchOpen(false);
                setTickerInput('');
              }}
              returnKeyType="go"
            />
            <TouchableOpacity
              onPress={() => {
                if (!tickerInput) return;
                setTicker(tickerInput);
                setTickerSearchOpen(false);
                setTickerInput('');
              }}
              disabled={!tickerInput}
              style={[styles.tickerSearchGo, { backgroundColor: tickerInput ? colors.accent : colors.border }]}
            >
              <Ionicons name="arrow-forward" size={16} color={colors.iconButton ?? '#fff'} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <OptionsChainPicker ticker={ticker} colors={colors} visible={visible} onSubmitted={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  controls:     { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  controlLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },

  tickerRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tickerChip:        { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 100, borderWidth: 1 },
  tickerChipText:    { fontSize: 14, fontWeight: '700' },
  tickerSearchToggle:{ width: 36, height: 36, borderRadius: 100, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tickerSearchRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  tickerSearchInput: { flex: 1, fontSize: 14, fontWeight: '600', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  tickerSearchGo:    { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
