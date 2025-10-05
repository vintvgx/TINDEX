"use client";
/**
 * Financials tab displayed within [ticker].tsx
 */

import type React from "react";
import { View, Text } from "react-native";
import { AppStoreCard } from "@/common/components/ui/AppStoreCard";
import type { TickerData } from "@/common/types/blogPosts/ticker";

interface FinancialsTabProps {
  stockData: TickerData;
}

export const FinancialsTab: React.FC<FinancialsTabProps> = ({ stockData }) => {
  // Helper function to format market cap
  const formatMarketCap = (marketCap: number): string => {
    if (marketCap >= 1000000000000) {
      return `$${(marketCap / 1000000000000).toFixed(1)}T`;
    } else if (marketCap >= 1000000000) {
      return `$${(marketCap / 1000000000).toFixed(1)}B`;
    } else if (marketCap >= 1000000) {
      return `$${(marketCap / 1000000).toFixed(1)}M`;
    } else {
      return `$${marketCap.toLocaleString()}`;
    }
  };

  return (
    <>
      {/* Key Metrics */}
      <View className="mb-8">
        <Text className="text-white text-xl font-bold tracking-tight mb-6 px-2">
          Key Metrics
        </Text>
        <View className="flex-row flex-wrap justify-between">
          {/* Market Cap */}
          {stockData.market_cap && (
            <View className="w-[48%] mb-4">
              <AppStoreCard variant="compact">
                <View className="p-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Market Cap
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight">
                    {formatMarketCap(stockData.market_cap)}
                  </Text>
                </View>
              </AppStoreCard>
            </View>
          )}

          {/* P/E Ratio */}
          {stockData.pe_ratio && (
            <View className="w-[48%] mb-4">
              <AppStoreCard variant="compact">
                <View className="p-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    P/E Ratio
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight">
                    {stockData.pe_ratio.toFixed(2)}
                  </Text>
                </View>
              </AppStoreCard>
            </View>
          )}

          {/* Price to Book */}
          {stockData.price_to_book && (
            <View className="w-[48%] mb-4">
              <AppStoreCard variant="compact">
                <View className="p-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Price to Book
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight">
                    {stockData.price_to_book.toFixed(2)}
                  </Text>
                </View>
              </AppStoreCard>
            </View>
          )}

          {/* Dividend Yield */}
          {stockData.dividend_yield && (
            <View className="w-[48%] mb-4">
              <AppStoreCard variant="compact">
                <View className="p-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Dividend Yield
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight">
                    {(stockData.dividend_yield * 100).toFixed(2)}%
                  </Text>
                </View>
              </AppStoreCard>
            </View>
          )}

          {/* Profit Margins */}
          {stockData.profit_margins !== undefined && stockData.profit_margins !== null && (
            <View className="w-[48%] mb-4">
              <AppStoreCard variant="compact">
                <View className="p-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Profit Margins
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight">
                    {(stockData.profit_margins * 100).toFixed(2)}%
                  </Text>
                </View>
              </AppStoreCard>
            </View>
          )}

          {/* Employees */}
          {stockData.employees !== undefined && stockData.employees !== null && (
            <View className="w-[48%] mb-4">
              <AppStoreCard variant="compact">
                <View className="p-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Employees
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight">
                    {stockData.employees.toLocaleString()}
                  </Text>
                </View>
              </AppStoreCard>
            </View>
          )}

          {/* Debt to Equity */}
          {stockData.debt_to_equity !== undefined && stockData.debt_to_equity !== null && (
            <View className="w-[48%] mb-4">
              <AppStoreCard variant="compact">
                <View className="p-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Debt to Equity
                  </Text>
                  <Text className="text-white text-lg font-bold tracking-tight">
                    {stockData.debt_to_equity.toFixed(2)}
                  </Text>
                </View>
              </AppStoreCard>
            </View>
          )}
        </View>
      </View>

      {/* News Data */}
      {stockData.news_data && stockData.news_data.length > 0 && (
        <View className="mb-8">
          <Text className="text-white text-xl font-bold tracking-tight mb-6 px-2">
            Latest News
          </Text>
          <AppStoreCard variant="featured">
            <View className="p-0">
              {stockData.news_data.slice(0, 3).map((news, index) => (
                <View
                  key={news.id}
                  className={`p-6 ${index > 0 ? "border-t border-gray-700/50" : ""}`}>
                  {news.content.title && (
                    <Text className="text-white font-bold tracking-wide mb-2">
                      {news.content.title}
                    </Text>
                  )}
                  {news.content.summary && (
                    <Text className="text-gray-300 text-sm font-medium mb-2">
                      {news.content.summary}
                    </Text>
                  )}
                  <View className="flex-row justify-between items-center">
                    {news.content.provider?.displayName && (
                      <Text className="text-gray-400 text-xs">
                        {news.content.provider.displayName}
                      </Text>
                    )}
                    {news.content.pubDate && (
                      <Text className="text-gray-400 text-xs">
                        {new Date(news.content.pubDate).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </AppStoreCard>
        </View>
      )}

      {/* Financial Growth */}
      <View className="mb-8">
        <AppStoreCard variant="featured">
          <View className="p-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-white text-xl font-bold tracking-tight">
                Growth Metrics
              </Text>
              <View className="bg-purple-500/20 px-3 py-1 rounded-full border border-purple-400/30">
                <Text className="text-purple-400 text-sm font-medium">
                  Financials
                </Text>
              </View>
            </View>
            
            <View className="flex-row justify-between">
              {/* Earnings Growth */}
              {stockData.earnings_growth !== undefined && stockData.earnings_growth !== null && (
                <View className="flex-1 mr-4">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Earnings Growth
                  </Text>
                  <Text className="text-white text-lg font-bold">
                    {(stockData.earnings_growth * 100).toFixed(2)}%
                  </Text>
                </View>
              )}
              
              {/* Revenue Growth */}
              {stockData.revenue_growth !== undefined && stockData.revenue_growth !== null && (
                <View className="flex-1">
                  <Text className="text-gray-400 text-sm font-medium mb-1">
                    Revenue Growth
                  </Text>
                  <Text className="text-white text-lg font-bold">
                    {(stockData.revenue_growth * 100).toFixed(2)}%
                  </Text>
                </View>
              )}
            </View>
            
            {/* Return on Equity */}
            {stockData.return_on_equity !== undefined && stockData.return_on_equity !== null && (
              <View className="mt-4">
                <Text className="text-gray-400 text-sm font-medium mb-1">
                  Return on Equity
                </Text>
                <Text className="text-white text-lg font-bold">
                  {(stockData.return_on_equity * 100).toFixed(2)}%
                </Text>
              </View>
            )}
          </View>
        </AppStoreCard>
      </View>
    </>
  );
};