import type React from 'react';
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useTickerQuery } from '@/hooks/queries/ticker/useTickerQuery';
import { useTickerHistoryQuery } from '@/hooks/queries/ticker/useTickerHistoryQuery';
import { useIsFollowingORB, useToggleORBFollow } from '@/hooks/mutations/ticker/tickerORB';
import { useGenerateTickerUpdateMutation } from '@/hooks/mutations/ticker/useGenerateTickerUpdateMutation';
import { PriceChart, ScrubPoint } from '@/common/components/ticker/PriceChart';
import { PriceChartFullScreen } from '@/common/components/ticker/PriceChartFullScreen';
import { AnalyticsTab } from '@/common/components/ticker/AnalyticsTab';
import { FinancialsTab } from '@/common/components/ticker/FinancialsTab';
import { OptionsChainPicker } from '@/common/components/strategy/OptionsChainPicker';
import { UpdatesTab } from '@/common/components/ticker/UpdatesTab';
import { FiftyTwoWeekRangeBar } from '@/common/components/ticker/FiftyTwoWeekRangeBar';
import { Skeleton } from '@/common/components/ui/Skeleton';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { formatMarketCap } from '@/common/utils/format/marketCap';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

interface TickerDetailSheetProps {
  ticker: string;
  onClose: () => void;
}

type SubScreen = 'contracts' | 'insights' | 'financials' | 'updates' | null;

export const TickerDetailSheet: React.FC<TickerDetailSheetProps> = ({ ticker, onClose }) => {
  const colors = useThemeColors();
  const { authState: { user } } = useAuth();

  const [period, setPeriod] = useState<PricePeriod>('1D');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [scrubPoint, setScrubPoint] = useState<ScrubPoint | null>(null);
  const [fullScreenChart, setFullScreenChart] = useState(false);
  // Own paper/live toggle for the Contracts tab — OptionsChainPicker no
  // longer owns this itself (see ImmediateTradePanel for why it moved up:
  // a persistent background tint needs a value from above it to apply to).
  const [paperMode, setPaperMode] = useState(true);

  const { data: tickerResponse, isLoading, isRefetching, refetch } = useTickerQuery(ticker);
  const stockData = tickerResponse?.data;

  const { data: historyResponse, isLoading: historyLoading } = useTickerHistoryQuery(ticker, period);
  const historyData = historyResponse?.data;

  const { data: isFollowingORB } = useIsFollowingORB(ticker);
  const toggleORBFollow = useToggleORBFollow(ticker);
  const generateTickerUpdate = useGenerateTickerUpdateMutation();

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

  const handleGenerateTweet = () => {
    if (!user?.id) return;
    generateTickerUpdate.mutate({ ticker, userId: user.id, targetLength: 500 });
  };

  if (subScreen && stockData) {
    return (
      <SubScreenHost
        title={subScreenTitle(subScreen)}
        onBack={() => setSubScreen(null)}
        rightAction={
          subScreen === 'updates' ? (
            <Pressable onPress={handleGenerateTweet} disabled={generateTickerUpdate.isPending || !user?.id} hitSlop={10}>
              {generateTickerUpdate.isPending ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="create-outline" size={20} color={!user?.id ? colors.textTertiary : colors.accent} />
              )}
            </Pressable>
          ) : undefined
        }
      >
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
                onSubmitted={() => setSubScreen(null)}
              />
            </>
          ))}
        {subScreen === 'insights' && <ScrollView contentContainerStyle={{ padding: 20 }}><AnalyticsTab stockData={stockData} /></ScrollView>}
        {subScreen === 'financials' && <ScrollView contentContainerStyle={{ padding: 20 }}><FinancialsTab stockData={stockData} /></ScrollView>}
        {subScreen === 'updates' && <UpdatesTab ticker={ticker} />}
      </SubScreenHost>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 8 }}>
        <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-down" size={22} color={colors.text} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{ticker}</Text>
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
        ) : (
          <Skeleton width={140} height={18} />
        )}
      </View>

      {/* Price + change */}
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        {displayPrice != null ? (
          <Text style={{ color: colors.text, fontSize: 40, fontWeight: '800', letterSpacing: -1 }}>
            ${displayPrice.toFixed(2)}
          </Text>
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
        ) : (
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
        <PriceChart
          data={historyData}
          isLoading={historyLoading}
          period={period}
          onPeriodChange={setPeriod}
          positive={periodPositive}
          onScrub={setScrubPoint}
        />
      </View>

      <PriceChartFullScreen
        visible={fullScreenChart}
        onClose={() => setFullScreenChart(false)}
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

      {/* Insights link */}
      <Pressable
        onPress={() => stockData && setSubScreen('insights')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 }}
      >
        <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '600' }}>Insights</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.accent} />
      </Pressable>

      {/* Market Cap */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 15, fontWeight: '500' }}>Market Cap</Text>
        {stockData?.market_cap != null ? (
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{formatMarketCap(stockData.market_cap)}</Text>
        ) : (
          <Skeleton width={70} height={16} />
        )}
      </View>

      {/* 52-week range */}
      {stockData?.year_low != null && stockData?.year_high != null && stockData?.current_price != null ? (
        <FiftyTwoWeekRangeBar
          currentPrice={stockData.current_price}
          yearLow={stockData.year_low}
          yearHigh={stockData.year_high}
        />
      ) : (
        <Skeleton width="100%" height={56} style={{ marginBottom: 24 }} />
      )}

      {/* Revenue / P/E */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 24 }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: colors.textTertiary, fontSize: 13, marginBottom: 4 }}>Revenue</Text>
          {stockData?.revenue_growth != null ? (
            <Text style={{ color: stockData.revenue_growth >= 0 ? colors.success : colors.error, fontSize: 18, fontWeight: '700' }}>
              {stockData.revenue_growth >= 0 ? '+' : ''}
              {(stockData.revenue_growth * 100).toFixed(1)}%
            </Text>
          ) : (
            <Skeleton width={60} height={18} />
          )}
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>YoY growth</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: colors.textTertiary, fontSize: 13, marginBottom: 4 }}>P/E Ratio</Text>
          {stockData?.pe_ratio != null ? (
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{stockData.pe_ratio.toFixed(1)}</Text>
          ) : (
            <Skeleton width={40} height={18} />
          )}
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>Valuation</Text>
        </View>
      </View>

      {/* Financial Details */}
      <Pressable
        onPress={() => stockData && setSubScreen('financials')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 18,
          marginBottom: 12,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }}>FINANCIAL DETAILS</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>

      {/* Updates */}
      <Pressable
        onPress={() => stockData && setSubScreen('updates')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 18,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }}>UPDATES</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>

      {isLoading && !stockData && (
        <View style={{ alignItems: 'center', marginTop: 24 }}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </View>
      )}
    </ScrollView>
  );
};

const subScreenTitle = (screen: Exclude<SubScreen, null>) => {
  switch (screen) {
    case 'contracts':
      return 'Contracts';
    case 'insights':
      return 'Insights';
    case 'financials':
      return 'Financial Details';
    case 'updates':
      return 'Updates';
  }
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
