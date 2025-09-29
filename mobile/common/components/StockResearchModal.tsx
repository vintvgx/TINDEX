import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebViewModal } from "./WebViewModal";

interface StockResearchModalProps {
  visible: boolean;
  onClose: () => void;
  researchData: any; // Using any for now since the data structure might vary
  ticker: string;
}

type TabType = "news" | "recommendations" | "overview" | "metrics";

export const StockResearchModal: React.FC<StockResearchModalProps> = ({
  visible,
  onClose,
  researchData,
  ticker,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [webViewVisible, setWebViewVisible] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<{
    url: string;
    title: string;
  } | null>(null);

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: "overview", label: "Company Overview", icon: "business" },
    { id: "recommendations", label: "Analyst Ratings", icon: "trending-up" },
    { id: "news", label: "Recent News", icon: "newspaper" },
    { id: "metrics", label: "Financial Metrics", icon: "analytics" },
  ];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatMarketCap = (marketCap: number): string => {
    if (marketCap >= 1e12) {
      return `$${(marketCap / 1e12).toFixed(2)}T`;
    } else if (marketCap >= 1e9) {
      return `$${(marketCap / 1e9).toFixed(2)}B`;
    } else if (marketCap >= 1e6) {
      return `$${(marketCap / 1e6).toFixed(2)}M`;
    } else {
      return `$${marketCap.toLocaleString()}`;
    }
  };

  const renderNewsTab = () => {
    const newsData = researchData?.news_data || [];

    const handleNewsPress = (item: any) => {
      const url = item.content?.canonicalUrl?.url || item.content?.clickThroughUrl?.url;
      if (url) {
        setSelectedArticle({
          url,
          title: item.content?.title || "Article"
        });
        setWebViewVisible(true);
      }
    };

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="space-y-4">
          {newsData.slice(0, 10).map((item: any, index: number) => {
            const url = item.content?.canonicalUrl?.url || item.content?.clickThroughUrl?.url;
            const isClickable = !!url;
            
            return (
              <Pressable
                key={index}
                onPress={() => handleNewsPress(item)}
                disabled={!isClickable}
                className={`bg-gray-50 rounded-xl p-4 ${isClickable ? 'active:bg-gray-100' : ''}`}>
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <Text className="text-xs text-gray-500">
                      {item.content?.provider?.displayName || "Unknown Source"}
                    </Text>
                    <Text className="text-xs text-gray-400 ml-2">
                      {formatDate(item.content?.pubDate || "")}
                    </Text>
                  </View>
                  {isClickable && (
                    <Ionicons name="open-outline" size={16} color="#6B7280" />
                  )}
                </View>
                <Text className="text-base font-semibold text-gray-900 mb-2">
                  {item.content?.title || "No title available"}
                </Text>
                <Text className="text-sm text-gray-600" numberOfLines={3}>
                  {item.content?.summary || "No summary available"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderRecommendationsTab = () => {
    const recommendations = researchData?.recommendations || [];
    const currentRecommendations = recommendations[0]; // Most recent

    if (!currentRecommendations) {
      return (
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-500">
            No analyst recommendations available
          </Text>
        </View>
      );
    }

    const totalRatings =
      currentRecommendations.strongBuy +
      currentRecommendations.buy +
      currentRecommendations.hold +
      currentRecommendations.sell +
      currentRecommendations.strongSell;

    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="space-y-6">
          {/* Summary */}
          <View className="bg-blue-50 rounded-xl p-4">
            <Text className="text-lg font-bold text-gray-900 mb-2">
              Analyst Consensus
            </Text>
            <Text className="text-sm text-gray-600">
              Based on {totalRatings} analyst ratings
            </Text>
          </View>

          {/* Rating Breakdown */}
          <View className="space-y-3">
            <Text className="text-lg font-bold text-gray-900">
              Rating Breakdown
            </Text>

            {[
              {
                label: "Strong Buy",
                count: currentRecommendations.strongBuy,
                color: "bg-green-500",
              },
              {
                label: "Buy",
                count: currentRecommendations.buy,
                color: "bg-green-400",
              },
              {
                label: "Hold",
                count: currentRecommendations.hold,
                color: "bg-yellow-500",
              },
              {
                label: "Sell",
                count: currentRecommendations.sell,
                color: "bg-red-400",
              },
              {
                label: "Strong Sell",
                count: currentRecommendations.strongSell,
                color: "bg-red-500",
              },
            ].map((rating, index) => (
              <View
                key={index}
                className="flex-row items-center justify-between">
                <Text className="text-base text-gray-700">{rating.label}</Text>
                <View className="flex-row items-center">
                  <View
                    className={`w-4 h-4 rounded-full ${rating.color} mr-2`}
                  />
                  <Text className="text-base font-semibold text-gray-900">
                    {rating.count}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Historical Trends */}
          {recommendations.length > 1 && (
            <View className="space-y-3">
              <Text className="text-lg font-bold text-gray-900">
                Historical Trends
              </Text>
              {recommendations.slice(0, 4).map((rec: any, index: number) => (
                <View key={index} className="bg-gray-50 rounded-lg p-3">
                  <Text className="text-sm text-gray-600 mb-1">
                    {rec.period === "0m" ? "Current" : `${rec.period} ago`}
                  </Text>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-700">
                      Strong Buy: {rec.strongBuy}
                    </Text>
                    <Text className="text-sm text-gray-700">
                      Hold: {rec.hold}
                    </Text>
                    <Text className="text-sm text-gray-700">
                      Sell: {rec.sell}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderOverviewTab = () => {
    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="space-y-6">
          {/* Company Description */}
          <View className="bg-gray-50 rounded-xl p-4">
            <Text className="text-lg font-bold text-gray-900 mb-3">
              Company Description
            </Text>
            <Text className="text-base text-gray-800 leading-6">
              {researchData?.description || "No description available"}
            </Text>
          </View>

          {/* Key Information */}
          <View className="space-y-4">
            <Text className="text-lg font-bold text-gray-900">
              Key Information
            </Text>

            <View className="bg-gray-50 rounded-xl p-4">
              <View className="space-y-3">
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray-600">Company Name</Text>
                  <Text className="text-sm font-semibold text-gray-900">
                    {researchData?.company_name || "N/A"}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray-600">Sector</Text>
                  <Text className="text-sm font-semibold text-gray-900">
                    {researchData?.sector || "N/A"}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray-600">Industry</Text>
                  <Text className="text-sm font-semibold text-gray-900">
                    {researchData?.industry || "N/A"}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray-600">Employees</Text>
                  <Text className="text-sm font-semibold text-gray-900">
                    {researchData?.employees?.toLocaleString() || "N/A"}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray-600">Exchange</Text>
                  <Text className="text-sm font-semibold text-gray-900">
                    {researchData?.exchange || "N/A"}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray-600">Country</Text>
                  <Text className="text-sm font-semibold text-gray-900">
                    {researchData?.country || "N/A"}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Market Sentiment */}
          {researchData?.sentiment && (
            <View className="bg-gray-50 rounded-xl p-4">
              <Text className="text-lg font-bold text-gray-900 mb-3">
                Market Sentiment
              </Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-gray-700">Sentiment</Text>
                <View className="flex-row items-center">
                  <View
                    className={`w-3 h-3 rounded-full mr-2 ${
                      researchData.sentiment.sentiment === "bullish"
                        ? "bg-green-500"
                        : researchData.sentiment.sentiment === "bearish"
                          ? "bg-red-500"
                          : "bg-gray-500"
                    }`}
                  />
                  <Text className="text-base font-semibold text-gray-900 capitalize">
                    {researchData.sentiment.sentiment}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center justify-between mt-2">
                <Text className="text-base text-gray-700">Confidence</Text>
                <Text className="text-base font-semibold text-gray-900">
                  {researchData.sentiment.confidence?.toFixed(1)}%
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderMetricsTab = () => {
    return (
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="space-y-6">
          {/* Price Information */}
          <View className="bg-gray-50 rounded-xl p-4">
            <Text className="text-lg font-bold text-gray-900 mb-3">
              Price Information
            </Text>
            <View className="space-y-3">
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Current Price</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  ${researchData?.current_price?.toFixed(2) || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Day High</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  ${researchData?.day_high?.toFixed(2) || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Day Low</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  ${researchData?.day_low?.toFixed(2) || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">52 Week High</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  ${researchData?.year_high?.toFixed(2) || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">52 Week Low</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  ${researchData?.year_low?.toFixed(2) || "N/A"}
                </Text>
              </View>
            </View>
          </View>

          {/* Financial Metrics */}
          <View className="bg-gray-50 rounded-xl p-4">
            <Text className="text-lg font-bold text-gray-900 mb-3">
              Financial Metrics
            </Text>
            <View className="space-y-3">
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Market Cap</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {formatMarketCap(researchData?.market_cap || 0)}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">P/E Ratio</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {researchData?.pe_ratio?.toFixed(2) || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Price to Book</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {researchData?.price_to_book?.toFixed(2) || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Debt to Equity</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {researchData?.debt_to_equity?.toFixed(2) || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Return on Equity</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {(researchData?.return_on_equity * 100)?.toFixed(2) + "%" ||
                    "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Profit Margins</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {(researchData?.profit_margins * 100)?.toFixed(2) + "%" ||
                    "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Revenue Growth</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {(researchData?.revenue_growth * 100)?.toFixed(2) + "%" ||
                    "N/A"}
                </Text>
              </View>
            </View>
          </View>

          {/* Trading Information */}
          <View className="bg-gray-50 rounded-xl p-4">
            <Text className="text-lg font-bold text-gray-900 mb-3">
              Trading Information
            </Text>
            <View className="space-y-3">
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Volume</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {researchData?.volume?.toLocaleString() || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Average Volume</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {researchData?.average_volume?.toLocaleString() || "N/A"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-600">Beta</Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {researchData?.beta?.toFixed(2) || "N/A"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return renderOverviewTab();
      case "news":
        return renderNewsTab();
      case "recommendations":
        return renderRecommendationsTab();
      case "metrics":
        return renderMetricsTab();
      default:
        return renderNewsTab();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.8)" />

      {/* Header */}
      <View className="absolute top-0 left-0 right-0 z-10 bg-white pt-12 pb-4 px-4 border-b border-gray-200">
        <View className="flex-row justify-between items-center">
          <View className="flex-1">
            <Text className="text-xl font-bold text-gray-900">
              {ticker} Research Data
            </Text>
          </View>
          <Pressable onPress={onClose} className="bg-gray-100 rounded-full p-2">
            <Ionicons name="close" size={24} color="#374151" />
          </Pressable>
        </View>
      </View>

      {/* Tab Navigation */}
      <View className="pt-20 mt-10 pb-4 bg-white border-b border-gray-200">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="px-4">
          <View className="flex-row space-x-2">
            {tabs.map((tab) => (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                className={`flex-row items-center px-4 py-2 rounded-full ${
                  activeTab === tab.id ? "bg-blue-500" : "bg-gray-100"
                }`}>
                <Ionicons
                  name={tab.icon as any}
                  size={16}
                  color={activeTab === tab.id ? "white" : "#6B7280"}
                  className="mr-2"
                />
                <Text
                  className={`text-sm font-medium ${
                    activeTab === tab.id ? "text-white" : "text-gray-600"
                  }`}>
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Tab Content */}
      <View className="flex-1 bg-white px-4 pt-4">{renderTabContent()}</View>

      {/* WebView Modal for News Articles */}
      <WebViewModal
        visible={webViewVisible}
        onClose={() => {
          setWebViewVisible(false);
          setSelectedArticle(null);
        }}
        url={selectedArticle?.url || ""}
        title={selectedArticle?.title || "Article"}
      />
    </Modal>
  );
};
