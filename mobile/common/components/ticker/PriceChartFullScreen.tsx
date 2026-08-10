import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, StatusBar, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketStream } from '@/hooks/useMarketStream';
import { useChartLiveStream } from '@/hooks/queries/ticker/useChartLiveStream';
import { useToast } from '@/common/components/ui/Toast';
import { useTickerORBRange } from '@/hooks/queries/orb/useTickerORBRange';
import { computeOrbRangeFromHistory } from '@/common/utils/orb/computeOrbRangeFromHistory';
import { useTickerSupportResistance } from '@/hooks/queries/technicals/useTickerSupportResistance';
import { AdvancedPriceChart, AdvancedScrubPoint, ChartReferenceLine } from '@/common/components/ticker/AdvancedPriceChart';
import type { PricePeriod, TickerHistoryData } from '@/common/types/blogPosts/ticker';
import { useLivePositionsData, LivePositionsBody } from '@/common/components/strategy/LivePositionsSection';
import { LiveModeToggle } from '@/common/components/strategy/LiveModeToggle';
import { LiveTradesTickerTape } from '@/common/components/ticker/LiveTradesTickerTape';

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

  // Feeds the shaded ORB band drawn directly on the chart (see
  // AdvancedPriceChart) — the separate "ORB Range" status card that used to
  // sit below the chart was removed (2026-07-31): redundant now that the
  // above/below/in-range status shows in the tickertape header instead.
  // Falls back to a client-computed range (from this chart's own 1D bars)
  // whenever there's no orb_ranges row for the ticker — e.g. one not
  // followed by an active strategy — so the band shows for ANY ticker
  // opened here, not just ORB-tracked ones.
  const { data: orbData } = useTickerORBRange(visible ? ticker : '');
  const fallbackOrb = !orbData ? computeOrbRangeFromHistory(historyData) : null;
  const effectiveOrb = orbData
    ? { high: orbData.orb_high, low: orbData.orb_low }
    : fallbackOrb
      ? { high: fallbackOrb.orb_high, low: fallbackOrb.orb_low }
      : null;

  // Historical (multi-day) support/resistance — opt-in, off by default, so
  // it never clutters the chart unasked. A fundamentally different concept
  // from the ORB band above (same-session only, always shown) — see
  // useTickerSupportResistance's docstring. Support = green, resistance =
  // red, dashed to stay visually distinct from the ORB band's solid lines
  // and from any position SL/TP lines this chart might show elsewhere.
  const [showSR, setShowSR] = useState(false);
  const { data: srData } = useTickerSupportResistance(visible && showSR ? ticker : null);
  // AdvancedPriceChart folds EVERY referenceLine price into the y-axis
  // min/max unconditionally (it has to — that's exactly right for an entry/
  // TP/stop line, always close to its own trade's range). S/R levels don't
  // share that property: the swing-detection lookback is 2 years, so a
  // strongly-touched level can legitimately sit 20-40%+ away from spot.
  // Folding ALL of them in stretches the domain so far that the actual
  // candles get crushed into a sliver in the middle — unreadable on any
  // period, not just an edge case (2026-08-10 fix). Bounding to levels
  // within 20% of current price keeps the chart legible on every period
  // while still surfacing anything close enough to matter for a near-term
  // decision — which is the only kind of S/R level worth seeing on a price
  // chart anyway.
  const SR_MAX_DISTANCE_PCT = 0.20;
  const srReferenceLines: ChartReferenceLine[] | null = srData
    ? [
        ...srData.support
          .filter(lv => (srData.current_price - lv.price) / srData.current_price <= SR_MAX_DISTANCE_PCT)
          .map((lv): ChartReferenceLine => ({
            label: `S $${lv.price.toFixed(2)}`, price: lv.price, color: colors.success, dash: '4,3',
          })),
        ...srData.resistance
          .filter(lv => (lv.price - srData.current_price) / srData.current_price <= SR_MAX_DISTANCE_PCT)
          .map((lv): ChartReferenceLine => ({
            label: `R $${lv.price.toFixed(2)}`, price: lv.price, color: colors.error, dash: '4,3',
          })),
      ]
    : null;

  // Open contracts for this ticker, below the chart — see LivePositionsSection.
  const [contractsMode, setContractsMode] = useState<'live' | 'paper'>('live');
  const positionsData = useLivePositionsData(contractsMode, ticker);
  const contractsCounts = {
    live:  useLivePositionsData('live', ticker).filteredPositions.length,
    paper: useLivePositionsData('paper', ticker).filteredPositions.length,
  };

  // Reset when the sheet closes so reopening starts fresh, and so the
  // WebSockets below disconnect rather than idling in the background.
  useEffect(() => {
    if (!visible) { setScrubPoint(null); }
  }, [visible]);

  const toast = useToast();
  // Alpaca paper-key stream is force-disabled — see useChartPriceSource.
  const useAlpacaStream = false;

  // Real-time paper-key Alpaca trade stream — see
  // useChartLiveStream/stock_chart_stream.py. Kept separate from the
  // yfinance-backed useMarketStream below (which stays subscribed
  // regardless of the chosen source) so a bad Alpaca connection can fall
  // back instantly instead of needing a fresh subscribe.
  const chartStream = useChartLiveStream(ticker, false);
  const { livePrices } = useMarketStream([ticker], { enabled: visible });

  const alpacaUsable = useAlpacaStream && !chartStream.error && chartStream.price != null;
  const resolvedLivePrice = alpacaUsable ? chartStream.price! : livePrices[ticker] ?? currentPrice;

  // Notify once per failure streak (not on every reconnect tick) so a flaky
  // stream during the trading day doesn't get missed, but also doesn't spam.
  const notifiedErrorRef = useRef(false);
  useEffect(() => {
    if (!visible || !useAlpacaStream) return;
    if (chartStream.error && !notifiedErrorRef.current) {
      notifiedErrorRef.current = true;
      toast.warning(`Live chart stream for ${ticker} is down — showing delayed (Yahoo) price instead.`);
    } else if (!chartStream.error) {
      notifiedErrorRef.current = false;
    }
  }, [visible, useAlpacaStream, chartStream.error, ticker, toast]);

  const periodStartPrice = historyData?.prices?.[0];
  const scrubChange = scrubPoint && periodStartPrice != null ? scrubPoint.price - periodStartPrice : null;
  const scrubChangePercent = scrubChange != null && periodStartPrice ? (scrubChange / periodStartPrice) * 100 : null;

  // Header price must track the live tick (same source AdvancedPriceChart's
  // own last-price line uses below) — it previously showed the static
  // `currentPrice` prop (a one-time REST snapshot from when the sheet
  // opened) and never moved again. priceChange/priceChangePercent are
  // recomputed against the same day-open reference so they stay consistent
  // with the live price instead of freezing at their initial values.
  const headerLivePrice = resolvedLivePrice;
  const dayRefPrice = (currentPrice != null && priceChange != null) ? currentPrice - priceChange : undefined;
  const liveChange = (headerLivePrice != null && dayRefPrice != null) ? headerLivePrice - dayRefPrice : priceChange;
  const liveChangePercent = (dayRefPrice) ? ((liveChange ?? 0) / dayRefPrice) * 100 : priceChangePercent;

  const displayPrice = scrubPoint ? scrubPoint.price : headerLivePrice;
  const displayChange = scrubPoint ? scrubChange ?? 0 : liveChange;
  const displayChangePercent = scrubPoint ? scrubChangePercent ?? 0 : liveChangePercent;
  const displayPositive = scrubPoint ? (scrubChange ?? 0) >= 0 : (liveChange ?? 0) >= 0;
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
        {/* Positioned above the header/back button, same as the global
            TickerTape sits above AppHeader elsewhere in the app. */}
        <LiveTradesTickerTape colors={colors} />

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
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 }}>
            <Pressable
              onPress={() => setShowSR(v => !v)}
              hitSlop={8}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
                borderWidth: 1, borderColor: showSR ? colors.accent : colors.separator,
                backgroundColor: showSR ? colors.accent + '18' : 'transparent',
              }}
            >
              <Ionicons name="analytics-outline" size={12} color={showSR ? colors.accent : colors.textTertiary} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: showSR ? colors.accent : colors.textTertiary }}>
                S/R
              </Text>
            </Pressable>
          </View>
          <AdvancedPriceChart
            data={historyData}
            isLoading={historyLoading}
            period={period}
            onPeriodChange={onPeriodChange}
            positive={periodPositive}
            onScrub={setScrubPoint}
            height={Math.min(340, Math.max(260, windowHeight * 0.38))}
            orbRange={effectiveOrb}
            showOrbRange
            livePrice={visible ? resolvedLivePrice ?? null : null}
            referenceLines={showSR ? srReferenceLines : null}
          />

          {/* Open contracts for this ticker — full data + editable SL/TP via
              the same LivePositionPanel used everywhere else (Edit/Add/Exit,
              live WS pricing). See LivePositionsSection.tsx. */}
          <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
                Open Contracts — {ticker}
              </Text>
              <LiveModeToggle mode={contractsMode} onChange={setContractsMode} counts={contractsCounts} colors={colors} />
            </View>
            <LivePositionsBody
              data={positionsData}
              mode={contractsMode}
              colors={colors}
              emptyTitle={`No Open ${contractsMode === 'live' ? 'Live' : 'Paper'} Contracts`}
              emptySubtitle={`Open ${ticker} positions will appear here.`}
              hideChartButton
            />
          </View>
        </View>
        </ScrollView>
      </View>
    </Modal>
  );
};
