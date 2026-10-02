import type React from 'react';
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { useChartInterval } from '@/hooks/useChartInterval';
import { useIsFollowingORB, useToggleORBFollow, useToggleAlertStar } from '@/hooks/mutations/ticker/tickerORB';
import { PriceChart, ScrubPoint } from '@/common/components/ticker/PriceChart';
import { PriceChartFullScreen } from '@/common/components/ticker/PriceChartFullScreen';
import { OptionsChainPicker } from '@/common/components/strategy/OptionsChainPicker';
import { TickerBrief } from '@/common/components/ticker/brief/TickerBrief';
import { Skeleton } from '@/common/components/ui/Skeleton';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

interface TickerDetailSheetProps {
  ticker: string;
  onClose: () => void;
  /** Opens straight into the full-screen chart (e.g. the "Open Chart" button
   *  on a live position card) instead of the default sheet overview. */
  initialFullScreenChart?: boolean;
}

// The insights/financials/updates sub-screens were replaced by the inline
// trading brief (TickerBrief); Contracts is the only sub-screen left.
type SubScreen = 'contracts' | null;

export const TickerDetailSheet: React.FC<TickerDetailSheetProps> = ({ ticker, onClose, initialFullScreenChart = false }) => {
  const colors = useThemeColors();

  const [period, setPeriod] = useState<PricePeriod>('1D');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [scrubPoint, setScrubPoint] = useState<ScrubPoint | null>(null);
  const [fullScreenChart, setFullScreenChart] = useState(initialFullScreenChart);
  // Own paper/live toggle for the Contracts tab — OptionsChainPicker no
  // longer owns this itself (see ImmediateTradePanel for why it moved up:
  // a persistent background tint needs a value from above it to apply to).
  const [paperMode, setPaperMode] = useState(true);

  const { data: tickerResponse, isError, isRefetching, refetchFresh } = useTickerQuery(ticker);
  const stockData = tickerResponse?.data;

  // Shares its persisted value with AdvancedPriceChart's own interval picker
  // via the same React-Query cache key (useChartInterval) — no prop
  // threading needed for the two to stay in sync.
  const { interval: chartInterval } = useChartInterval(period);

  // Poll on 1D so the chart's 5-min candles pick up the newest bar on their
  // own — see AdvancedPriceChart's countdown + PriceChartFullScreen's
  // header price, which previously only refreshed if you closed and
  // reopened the sheet. 30s matches this app's usual live-data poll cadence.
  const { data: historyResponse, isLoading: historyLoading, isError: historyIsError, refetch: refetchHistory } =
    useTickerHistoryQuery(ticker, period, period === '1D' ? 30_000 : undefined, chartInterval);
  const historyData = historyResponse?.data;

  const { data: isFollowingORB } = useIsFollowingORB(ticker);
  const toggleORBFollow = useToggleORBFollow(ticker);
  const toggleAlertStar = useToggleAlertStar(ticker);
  const alertStarred = !!isFollowingORB?.alert_starred;

  // Period-over-period direction drives the chart's line color, independent
  // of the header's day-change figure (which stays anchored to "today").
  const periodPositive =
    historyData && historyData.prices.length > 1
      ? historyData.prices[historyData.prices.length - 1] >= historyData.prices[0]
      : (stockData?.price_change ?? 0) >= 0;

  const dayPositive = (stockData?.price_change ?? 0) >= 0;

  // While scrubbing, price/change swap to the touched point, measured
  // against the start of the currently-selected period.
  const periodStartPrice = historyData?.prices?.[0];
  const scrubChange =
    scrubPoint && periodStartPrice != null ? scrubPoint.price - periodStartPrice : null;
  const scrubChangePercent =
    scrubChange != null && periodStartPrice ? (scrubChange / periodStartPrice) * 100 : null;

  const displayPrice = scrubPoint ? scrubPoint.price : stockData?.current_price;
  const displayChange = scrubPoint ? scrubChange ?? 0 : stockData?.price_change;
  const displayChangePercent = scrubPoint ? scrubChangePercent ?? 0 : stockData?.price_change_percent;
  const displayPositive = scrubPoint ? (scrubChange ?? 0) >= 0 : dayPositive;
  const priceColor = displayPositive ? colors.success : colors.error;

  const contractsReady = !!stockData;

  // No screen-level error: a failed ticker lookup leaves the header's price
  // inline "unavailable", and every brief section below fetches and fails
  // on its own.
  if (subScreen && stockData) {
    return (
      <SubScreenHost title="Contracts" onBack={() => setSubScreen(null)}>
        {subScreen === 'contracts' &&
          (stockData.has_options === false ? (
            <EmptyState icon="analytics-outline" message="This ticker does not have options trading available." />
          ) : (
            <>
              <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, backgroundColor: colors.card, borderColor: colors.border }}>
                  {([['Paper', true], ['Live', false]] as const).map(([label, isPaper]) => {
                    const active = paperMode === isPaper;
                    const tint = isPaper ? '#FF9F0A' : '#30D158';
                    return (
                      <Pressable
                        key={label}
                        onPress={() => setPaperMode(isPaper)}
                        style={[
                          { flex: 1, alignItems: 'center', paddingVertical: 7 },
                          active && { backgroundColor: tint + '22', borderRadius: 8 },
                        ]}
                      >
                        <Text style={{ fontSize: 13, color: active ? tint : colors.tabBarInactive, fontWeight: active ? '700' : '500' }}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <OptionsChainPicker
                ticker={ticker}
                colors={colors}
                visible={subScreen === 'contracts'}
                paperMode={paperMode}
                onChangePaperMode={setPaperMode}
                onSubmitted={() => setSubScreen(null)}
              />
            </>
          ))}
      </SubScreenHost>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchFresh} tintColor={colors.accent} />}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 8 }}>
        <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-down" size={22} color={colors.text} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{ticker}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {/* Alert priority — starred tickers get full zone-alert pushes. */}
          <Pressable
            onPress={() => toggleAlertStar.mutate(!alertStarred)}
            disabled={toggleAlertStar.isPending}
            hitSlop={10}
            style={{ padding: 4 }}
            accessibilityLabel={alertStarred ? 'Turn off priority alerts' : 'Turn on priority alerts'}
          >
            <Ionicons
              name={alertStarred ? 'notifications' : 'notifications-outline'}
              size={20}
              color={alertStarred ? colors.accent : colors.text}
            />
          </Pressable>
          <Pressable
            onPress={() => toggleORBFollow.mutate(!isFollowingORB?.orb_enabled)}
            disabled={toggleORBFollow.isPending}
            hitSlop={10}
            style={{ padding: 4 }}
          >
            <Ionicons
              name={isFollowingORB?.orb_enabled ? 'star' : 'star-outline'}
              size={20}
              color={isFollowingORB?.orb_enabled ? colors.warning : colors.text}
            />
          </Pressable>
        </View>
      </View>

      {/* Logo + company name */}
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        {stockData ? (
          <View style={{ marginBottom: 10 }}>
            <TickerLogo uri={stockData.logo_url} ticker={ticker} size={64} borderRadius={16} />
          </View>
        ) : (
          <Skeleton width={64} height={64} borderRadius={16} style={{ marginBottom: 10 }} />
        )}
        {stockData?.company_name ? (
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{stockData.company_name}</Text>
        ) : isError ? null : (
          <Skeleton width={140} height={18} />
        )}
      </View>

      {/* Price + change */}
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        {displayPrice != null ? (
          <Text style={{ color: colors.text, fontSize: 40, fontWeight: '800', letterSpacing: -1 }}>
            ${displayPrice.toFixed(2)}
          </Text>
        ) : isError ? (
          <UnavailableText />
        ) : (
          <Skeleton width={160} height={40} style={{ marginBottom: 6 }} />
        )}
        {displayChange != null && displayChangePercent != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 5 }}>
            <Ionicons
              name="triangle"
              size={11}
              color={priceColor}
              style={{ transform: [{ rotate: displayPositive ? '0deg' : '180deg' }] }}
            />
            <Text style={{ color: priceColor, fontWeight: '700', fontSize: 15 }}>
              {displayPositive ? '+' : ''}
              {displayChange.toFixed(2)} ({displayChangePercent.toFixed(2)}%)
            </Text>
          </View>
        ) : isError ? null : (
          <Skeleton width={110} height={16} style={{ marginTop: 6 }} />
        )}
      </View>

      {/* Chart */}
      <View style={{ marginBottom: 24 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 }}>
          <Pressable onPress={() => setFullScreenChart(true)} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="expand-outline" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
        {historyIsError && !historyData ? (
          <UnavailableBox message="Chart unable to be fetched" onRetry={() => refetchHistory()} />
        ) : (
          <PriceChart
            data={historyData}
            isLoading={historyLoading}
            period={period}
            onPeriodChange={setPeriod}
            positive={periodPositive}
            onScrub={setScrubPoint}
          />
        )}
      </View>

      <PriceChartFullScreen
        visible={fullScreenChart}
        onClose={() => {
          // Opened directly from a position card's "View Chart" button
          // (initialFullScreenChart) — there's no ticker overview underneath
          // the user actually asked to see, so back should dismiss the whole
          // sheet rather than reveal it.
          if (initialFullScreenChart) {
            onClose();
          } else {
            setFullScreenChart(false);
          }
        }}
        ticker={ticker}
        companyName={stockData?.company_name}
        currentPrice={stockData?.current_price}
        priceChange={stockData?.price_change}
        priceChangePercent={stockData?.price_change_percent}
        historyData={historyData}
        historyLoading={historyLoading}
        period={period}
        onPeriodChange={setPeriod}
        periodPositive={periodPositive}
      />

      {/* Contracts — primary CTA */}
      <Pressable
        onPress={() => contractsReady && setSubScreen('contracts')}
        disabled={!contractsReady}
        style={{
          backgroundColor: colors.accent,
          borderRadius: 16,
          paddingVertical: 16,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          opacity: contractsReady ? 1 : 0.6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="documents-outline" size={20} color={colors.accentForeground} />
          <View>
            <Text style={{ color: colors.accentForeground, fontSize: 16, fontWeight: '700' }}>Contracts</Text>
            <Text style={{ color: colors.accentForeground, fontSize: 12, opacity: 0.7 }}>
              {contractsReady ? 'View options chain' : 'Loading…'}
            </Text>
          </View>
        </View>
        {!contractsReady ? (
          <ActivityIndicator size="small" color={colors.accentForeground} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.accentForeground} />
        )}
      </Pressable>

      {/* Trading brief — each section loads and fails independently */}
      <TickerBrief ticker={ticker} />
    </ScrollView>
  );
};

const SubScreenHost: React.FC<{
  title: string;
  onBack: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, onBack, rightAction, children }) => {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={onBack} hitSlop={10} style={{ marginRight: 12 }}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
        </View>
        {rightAction}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
};

const UnavailableText: React.FC = () => {
  const colors = useThemeColors();
  return (
    <Text style={{ color: colors.textTertiary, fontSize: 13, fontStyle: 'italic' }}>Price unavailable</Text>
  );
};

const UnavailableBox: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => {
  const colors = useThemeColors();
  return (
    <View
      style={{
        height: 200,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={26} color={colors.textTertiary} />
      <Text style={{ marginTop: 8, fontSize: 13, color: colors.textSecondary, fontWeight: '600' }}>{message}</Text>
      <Pressable onPress={onRetry} hitSlop={10} style={{ marginTop: 10 }}>
        <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>Retry</Text>
      </Pressable>
    </View>
  );
};

const EmptyState: React.FC<{ icon: keyof typeof Ionicons.glyphMap; message: string }> = ({ icon, message }) => {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
        <Ionicons name={icon} size={40} color={colors.textTertiary} />
        <Text style={{ marginTop: 14, fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
          {message}
        </Text>
      </View>
    </View>
  );
};
