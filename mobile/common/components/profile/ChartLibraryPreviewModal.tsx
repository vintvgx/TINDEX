import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CandleStickChart } from 'react-native-gifted-charts';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { AdvancedPriceChart } from '@/common/components/ticker/AdvancedPriceChart';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Side-by-side comparison for the "evaluate react-native-gifted-charts"
 * TODO (2026-08-18) — same live 1D data rendered through the current
 * hand-rolled AdvancedPriceChart and through gifted-charts' CandleStickChart,
 * so the actual visual/interaction gap is something to look at rather than
 * argue about. This is a standalone preview screen, not wired into any real
 * chart flow — nothing here replaces charts.tsx unless a decision is made
 * to do that as a separate follow-up.
 */
export function ChartLibraryPreviewModal({ visible, onClose }: Props) {
  const colors = useThemeColors();
  const [tickerInput, setTickerInput] = useState('SPY');
  const [ticker, setTicker] = useState('SPY');

  const { data: historyResponse, isLoading } = useTickerHistoryQuery(ticker, '1D');
  const historyData = historyResponse?.success ? historyResponse.data : undefined;

  const positive = useMemo(() => {
    if (!historyData?.prices?.length) return true;
    return historyData.prices[historyData.prices.length - 1] >= historyData.prices[0];
  }, [historyData]);

  // gifted-charts' CandleStickChart wants {open, high, low, close} per bar —
  // AdvancedPriceChart's own OHLC arrays map directly, no reshaping beyond
  // zipping the four arrays together.
  const candleData = useMemo(() => {
    if (!historyData?.opens || !historyData.highs || !historyData.lows) return [];
    return historyData.opens.map((open, i) => ({
      open,
      high: historyData.highs![i],
      low: historyData.lows![i],
      close: historyData.prices[i],
    }));
  }, [historyData]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.separator,
        }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Chart Library Preview</Text>
          <Pressable onPress={onClose} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 }}>
          <TextInput
            value={tickerInput}
            onChangeText={t => setTickerInput(t.toUpperCase())}
            placeholder="Ticker (e.g. SPY)"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            style={{
              flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 9, color: colors.text, fontSize: 14,
            }}
          />
          <Pressable
            onPress={() => setTicker(tickerInput.trim().toUpperCase())}
            style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.accentForeground, fontWeight: '700', fontSize: 14 }}>Load</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textTertiary, letterSpacing: 0.4, marginBottom: 8 }}>
                CURRENT — AdvancedPriceChart (hand-rolled SVG)
              </Text>
              <AdvancedPriceChart
                data={historyData}
                ticker={ticker}
                period="1D"
                onPeriodChange={() => {}}
                positive={positive}
                height={280}
              />

              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textTertiary, letterSpacing: 0.4, marginTop: 28, marginBottom: 8 }}>
                react-native-gifted-charts — CandleStickChart
              </Text>
              {candleData.length > 0 ? (
                <View style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
                  <CandleStickChart
                    data={candleData}
                    height={220}
                    spacing={Math.max(2, Math.floor(300 / candleData.length))}
                    bullishColor={colors.success}
                    bearishColor={colors.error}
                    hideRules
                    yAxisTextStyle={{ color: colors.textTertiary, fontSize: 10 }}
                    xAxisColor={colors.separator}
                    yAxisColor={colors.separator}
                  />
                </View>
              ) : (
                <Text style={{ color: colors.textTertiary, fontSize: 13 }}>No OHLC data for this ticker/period.</Text>
              )}

              <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 18, marginTop: 20 }}>
                Note: this gifted-charts render uses its own default zoom/pan
                (limited), no scrub/crosshair, no volume sub-pane, and no
                live-tick blending on the last candle — AdvancedPriceChart
                already has all of that. This preview is for visual
                comparison of the candle rendering itself, not a
                feature-for-feature port.
              </Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
