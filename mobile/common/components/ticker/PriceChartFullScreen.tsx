import type React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, StatusBar, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useTickerORBRange } from '@/hooks/queries/orb/useTickerORBRange';
import { getOrbStatus } from '@/common/utils/orb/getOrbStatus';
import { AdvancedPriceChart, AdvancedScrubPoint } from '@/common/components/ticker/AdvancedPriceChart';
import type { PricePeriod, TickerHistoryData } from '@/common/types/blogPosts/ticker';

interface PriceChartFullScreenProps {
  visible: boolean;
  onClose: () => void;
  ticker: string;
  companyName?: string;
  currentPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
  historyData: TickerHistoryData | undefined;
  historyLoading?: boolean;
  period: PricePeriod;
  onPeriodChange: (period: PricePeriod) => void;
  periodPositive: boolean;
}

const ORB_STATUS_LABEL: Record<ReturnType<typeof getOrbStatus>, string> = {
  above: 'Above Range',
  below: 'Below Range',
  'in-range': 'In Range',
};

const formatVolume = (v: number) => {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
};

/**
 * Full-screen day-trading chart view, reached via the expand icon on the
 * compact chart. Renders AdvancedPriceChart (candles, axes, volume,
 * crosshair) with the ORB band overlaid by default whenever today's
 * Opening Range exists and the timeframe is 1D, plus a live
 * above/below/in-range badge driven by the market WebSocket.
 */
export const PriceChartFullScreen: React.FC<PriceChartFullScreenProps> = ({
  visible,
  onClose,
  ticker,
  companyName,
  currentPrice,
  priceChange,
  priceChangePercent,
  historyData,
  historyLoading,
  period,
  onPeriodChange,
  periodPositive,
}) => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [scrubPoint, setScrubPoint] = useState<AdvancedScrubPoint | null>(null);
  // ORB is on by default — the band only draws on 1D, and only when today's
  // range exists, so the default is harmless on other timeframes.
  const [showOrbRange, setShowOrbRange] = useState(true);

  const { data: orbData } = useTickerORBRange(visible ? ticker : '');
  const hasOrbData = orbData != null;

  // Reset when the sheet closes so reopening starts fresh, and so the
  // WebSocket below disconnects rather than idling in the background.
  useEffect(() => {
    if (!visible) { setShowOrbRange(true); setScrubPoint(null); }
  }, [visible]);

  // Live stream drives both the chart's last-price line and the ORB badge.
  const { livePrices } = useMarketStream([ticker], { enabled: visible });
  const livePrice = livePrices[ticker] ?? currentPrice ?? 0;
  const orbActive = showOrbRange && hasOrbData && period === '1D';
  const orbStatus = hasOrbData ? getOrbStatus(livePrice, orbData!.orb_high, orbData!.orb_low) : null;
  const orbStatusColor = orbStatus === 'above' ? colors.success : orbStatus === 'below' ? colors.error : colors.textSecondary;

  const periodStartPrice = historyData?.prices?.[0];
  const scrubChange = scrubPoint && periodStartPrice != null ? scrubPoint.price - periodStartPrice : null;
  const scrubChangePercent = scrubChange != null && periodStartPrice ? (scrubChange / periodStartPrice) * 100 : null;

  const displayPrice = scrubPoint ? scrubPoint.price : currentPrice;
  const displayChange = scrubPoint ? scrubChange ?? 0 : priceChange;
  const displayChangePercent = scrubPoint ? scrubChangePercent ?? 0 : priceChangePercent;
  const displayPositive = scrubPoint ? (scrubChange ?? 0) >= 0 : (priceChange ?? 0) >= 0;
  const priceColor = displayPositive ? colors.success : colors.error;

  const scrubHasOhlc = scrubPoint?.open != null && scrubPoint.high != null && scrubPoint.low != null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle={colors.isDark ? 'light-content' : 'dark-content'} />
      <View style={{ paddingTop: insets.top, flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
          <Pressable onPress={onClose} hitSlop={12} style={{ padding: 8, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
            <Text style={{ color: colors.text, fontSize: 16 }}>Back</Text>
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{ticker}</Text>
            {!!companyName && (
              <Text style={{ color: colors.textTertiary, fontSize: 12 }} numberOfLines={1}>{companyName}</Text>
            )}
          </View>
          <View style={{ width: 70 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
        <View style={{ alignItems: 'center', marginTop: 10, marginBottom: 8 }}>
          {displayPrice != null && (
            <Text style={{ color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -1 }}>
              ${displayPrice.toFixed(2)}
            </Text>
          )}
          {displayChange != null && displayChangePercent != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 5 }}>
              <Ionicons
                name="triangle"
                size={10}
                color={priceColor}
                style={{ transform: [{ rotate: displayPositive ? '0deg' : '180deg' }] }}
              />
              <Text style={{ color: priceColor, fontWeight: '700', fontSize: 14 }}>
                {displayPositive ? '+' : ''}
                {displayChange.toFixed(2)} ({displayChangePercent.toFixed(2)}%)
              </Text>
            </View>
          )}
          {/* Fixed-height OHLC readout: fills in while scrubbing a candle,
              stays empty otherwise so the chart below never reflows. */}
          <View style={{ height: 18, marginTop: 4, flexDirection: 'row', gap: 10 }}>
            {scrubHasOhlc && (
              <>
                {([
                  ['O', scrubPoint!.open!],
                  ['H', scrubPoint!.high!],
                  ['L', scrubPoint!.low!],
                  ['C', scrubPoint!.price],
                ] as const).map(([label, value]) => (
                  <Text key={label} style={{ fontSize: 12, color: colors.textSecondary, fontVariant: ['tabular-nums'] }}>
                    <Text style={{ color: colors.textTertiary, fontWeight: '600' }}>{label} </Text>
                    {value.toFixed(2)}
                  </Text>
                ))}
                {scrubPoint!.volume != null && (
                  <Text style={{ fontSize: 12, color: colors.textSecondary, fontVariant: ['tabular-nums'] }}>
                    <Text style={{ color: colors.textTertiary, fontWeight: '600' }}>Vol </Text>
                    {formatVolume(scrubPoint!.volume)}
                  </Text>
                )}
              </>
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <AdvancedPriceChart
            data={historyData}
            isLoading={historyLoading}
            period={period}
            onPeriodChange={onPeriodChange}
            positive={periodPositive}
            onScrub={setScrubPoint}
            height={Math.min(340, Math.max(260, windowHeight * 0.38))}
            orbRange={hasOrbData ? { high: orbData!.orb_high, low: orbData!.orb_low } : null}
            showOrbRange={showOrbRange}
            livePrice={visible ? livePrices[ticker] ?? null : null}
          />

          {hasOrbData && (
            <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: 12 }}>
              <Pressable
                onPress={() => {
                  if (orbActive) {
                    setShowOrbRange(false);
                    return;
                  }
                  // Activating from a non-intraday timeframe jumps to 1D —
                  // the band only exists for today's session.
                  setShowOrbRange(true);
                  if (period !== '1D') onPeriodChange('1D');
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: orbActive ? colors.accent : colors.border,
                  backgroundColor: orbActive ? colors.accent + '15' : 'transparent',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="git-compare-outline" size={18} color={orbActive ? colors.accent : colors.text} />
                  <View>
                    <Text style={{ color: orbActive ? colors.accent : colors.text, fontSize: 15, fontWeight: '700' }}>
                      ORB Range
                    </Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }}>
                      {orbActive
                        ? `${orbData!.orb_low.toFixed(2)} – ${orbData!.orb_high.toFixed(2)}`
                        : period === '1D' ? 'Hidden' : 'Tap to view on 1D'}
                    </Text>
                  </View>
                </View>
                {orbActive && orbStatus && (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, backgroundColor: orbStatusColor + '18', borderWidth: 1, borderColor: orbStatusColor + '40' }}>
                    <Text style={{ color: orbStatusColor, fontSize: 12, fontWeight: '700' }}>{ORB_STATUS_LABEL[orbStatus]}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          )}
        </View>
        </ScrollView>
      </View>
    </Modal>
  );
};
