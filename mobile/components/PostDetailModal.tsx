import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StatusBar,
  Dimensions,
} from 'react-native';
import { BlogPostType } from '@/types';
import { StockResearchData, PolygonData } from '@/types/categories/stocks/stock_types';
import { Ionicons } from '@expo/vector-icons'; // or your preferred icon library

interface PostDetailModalProps {
  post: BlogPostType | null;
  visible: boolean;
  onClose: () => void;
}

export const PostDetailModal: React.FC<PostDetailModalProps> = ({
  post,
  visible,
  onClose,
}) => {
  if (!post) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getImageUrl = () => {
    if (post.multimedia_data?.images?.[0]?.url) {
      return post.multimedia_data.images[0].url;
    }
    if (post.multimedia_data?.featured_image) {
      return post.multimedia_data.featured_image;
    }
    return 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=400&fit=crop';
  };

  // Check if post has stock research data
  const hasStockData = (): boolean => {
    console.log("Stock data observed within blog post: ", (post.topic?.category === 'stocks' && post.research_data?.polygonData))
    return post.topic?.category === 'stocks' && post.research_data?.polygonData;
  };

  // Get stock data from research_data
  const getStockData = (): StockResearchData | null => {
    if (!hasStockData()) return null;
    return post.research_data as StockResearchData;
  };

  // Get Polygon.io data specifically
  const getPolygonData = (): PolygonData | null => {
    const stockData = getStockData();
    return stockData?.polygonData || null;
  };

  // Format stock price with proper styling
  const formatStockPrice = (price: number, change: number, changePercent: number) => {
    const isPositive = change >= 0;
    const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
    const changeIcon = isPositive ? 'trending-up' : 'trending-down';
    
    return (
      <View className="flex-row items-center">
        <Text className="text-2xl font-bold text-gray-900">${price.toFixed(2)}</Text>
        <View className="flex-row items-center ml-3">
          <Ionicons 
            name={changeIcon as any} 
            size={20} 
            color={isPositive ? '#059669' : '#dc2626'} 
          />
          <Text className={`text-lg font-semibold ml-1 ${changeColor}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%)
          </Text>
        </View>
      </View>
    );
  };

  // Format market cap for display
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

  // Render comprehensive stock information section using Polygon.io data
  const renderStockSection = () => {
    const polygonData = getPolygonData();
    if (!polygonData?.tickerDetails) return null;

    const tickerDetails = polygonData.tickerDetails;
    const recentNews = polygonData.recentNews || [];
    const latestBar = polygonData.dailyBars?.[polygonData.dailyBars.length - 1];
    const previousBar = polygonData.previousClose;

    // Calculate price change if we have both current and previous data
    let currentPrice = 0;
    let priceChange = 0;
    let priceChangePercent = 0;

    if (latestBar && previousBar) {
      currentPrice = latestBar.c;
      priceChange = latestBar.c - previousBar.c;
      priceChangePercent = (priceChange / previousBar.c) * 100;
    } else if (latestBar) {
      currentPrice = latestBar.c;
    }

    return (
      <View className="mb-8">
        {/* Stock Header */}
        <View className="mb-6">
          <View className="flex-row justify-between items-start mb-4">
            <View className="flex-1">
              <Text className="text-3xl font-bold text-gray-900">
                {tickerDetails.ticker}
              </Text>
              <Text className="text-lg text-gray-600 mt-1">
                {tickerDetails.name}
              </Text>
            </View>
            <View className="bg-blue-100 px-3 py-2 rounded-full">
              <Text className="text-sm text-blue-700 font-semibold">
                STOCK
              </Text>
            </View>
          </View>

          {/* Price and Change */}
          {currentPrice > 0 && (
            <View className="mb-6">
              {formatStockPrice(currentPrice, priceChange, priceChangePercent)}
            </View>
          )}
        </View>

        {/* Key Metrics Grid */}
        <View className="mb-6">
          <Text className="text-xl font-bold text-gray-900 mb-4">Key Metrics</Text>
          <View className="bg-gray-50 rounded-xl p-4">
            <View className="flex-row flex-wrap">
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">Market Cap</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {formatMarketCap(tickerDetails.market_cap)}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">Exchange</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {tickerDetails.primary_exchange}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">Employees</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {tickerDetails.total_employees.toLocaleString()}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">Currency</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {tickerDetails.currency_name.toUpperCase()}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">Listed Date</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {new Date(tickerDetails.list_date).toLocaleDateString()}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">SIC Code</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {tickerDetails.sic_code}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Company Information */}
        <View className="mb-6">
          <Text className="text-xl font-bold text-gray-900 mb-4">Company Overview</Text>
          <View className="bg-gray-50 rounded-xl p-4">
            <Text className="text-base text-gray-800 leading-6 mb-3">
              {tickerDetails.description}
            </Text>
            
            <View className="flex-row flex-wrap">
              <View className="w-1/2 mb-3">
                <Text className="text-sm text-gray-500 mb-1">SIC Description</Text>
                <Text className="text-base font-semibold text-gray-900">
                  {tickerDetails.sic_description}
                </Text>
              </View>
              <View className="w-1/2 mb-3">
                <Text className="text-sm text-gray-500 mb-1">Market</Text>
                <Text className="text-base font-semibold text-gray-900">
                  {tickerDetails.market}
                </Text>
              </View>
              <View className="w-1/2 mb-3">
                <Text className="text-sm text-gray-500 mb-1">Locale</Text>
                <Text className="text-base font-semibold text-gray-900">
                  {tickerDetails.locale.toUpperCase()}
                </Text>
              </View>
              <View className="w-1/2 mb-3">
                <Text className="text-sm text-gray-500 mb-1">Phone</Text>
                <Text className="text-base font-semibold text-gray-900">
                  {tickerDetails.phone_number}
                </Text>
              </View>
            </View>

            {/* Company Address */}
            <View className="mt-3">
              <Text className="text-sm text-gray-500 mb-1">Address</Text>
              <Text className="text-base font-semibold text-gray-900">
                {tickerDetails.address.address1}, {tickerDetails.address.city}, {tickerDetails.address.state} {tickerDetails.address.postal_code}
              </Text>
            </View>
          </View>
        </View>

        {/* Recent News */}
        {recentNews.length > 0 && (
          <View className="mb-6">
            <Text className="text-xl font-bold text-gray-900 mb-4">Recent News</Text>
            <View className="space-y-3">
              {recentNews.slice(0, 3).map((item, index) => (
                <View key={index} className="bg-gray-50 rounded-xl p-4">
                  <View className="flex-row items-center mb-2">
                    {item.publisher.logo_url && (
                      <Image 
                        source={{ uri: item.publisher.logo_url }} 
                        className="w-6 h-6 mr-2 rounded"
                        style={{ resizeMode: 'contain' }}
                      />
                    )}
                    <Text className="text-xs text-gray-500">
                      {item.publisher.name}
                    </Text>
                  </View>
                  <Text className="text-base font-semibold text-gray-900 mb-2" numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text className="text-sm text-gray-600 mb-2" numberOfLines={3}>
                    {item.description}
                  </Text>
                  <View className="flex-row justify-between items-center">
                    <Text className="text-xs text-gray-500">
                      {new Date(item.published_utc).toLocaleDateString()}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {item.author}
                    </Text>
                  </View>
                  
                  {/* Sentiment insights if available */}
                  {item.insights && item.insights.length > 0 && (
                    <View className="mt-2 pt-2 border-t border-gray-200">
                      {item.insights.filter(insight => insight.ticker === tickerDetails.ticker).map((insight, idx) => (
                        <View key={idx} className="flex-row items-center">
                          <View className={`w-2 h-2 rounded-full mr-2 ${
                            insight.sentiment === 'positive' ? 'bg-green-500' : 
                            insight.sentiment === 'negative' ? 'bg-red-500' : 'bg-gray-500'
                          }`} />
                          <Text className="text-xs text-gray-600">
                            {insight.sentiment_reasoning}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet" // iOS only - gives native modal feel
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.8)" />
      
      {/* Header with close button */}
      <View className="absolute top-0 left-0 right-0 z-10 bg-transparent pt-12 pb-4 px-4">
        <View className="flex-row justify-between items-center">
          <View />
          <Pressable
            onPress={onClose}
            className="bg-black/50 rounded-full p-2 backdrop-blur-sm"
          >
            <Ionicons name="close" size={24} color="white" />
          </Pressable>
        </View>
      </View>

      <ScrollView 
        className="flex-1 bg-white"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Hero Image */}
        <View className="relative">
          <Image
            source={{ uri: getImageUrl() }}
            className="w-full h-80"
            style={{ resizeMode: 'cover' }}
          />
          <View className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
        </View>

        {/* Content Container */}
        <View className="px-6 py-6 -mt-8 bg-white rounded-t-3xl relative z-10">
          {/* Topics/Tags */}
          {post.topic && (
            <View className="flex-row flex-wrap mb-4">
              <View className="bg-blue-100 px-3 py-1.5 rounded-full">
                <Text className="text-sm text-blue-700 font-semibold">
                  {post.topic.name}
                </Text>
              </View>
            </View>
          )}

          {/* Title */}
          <Text className="text-3xl font-bold text-gray-900 mb-4 leading-tight">
            {post.title}
          </Text>

          {/* Meta Information */}
          <View className="flex-row justify-between items-center mb-6 pb-6 border-b border-gray-200">
            <Text className="text-base text-gray-600 font-medium">
              {formatDate(post.created_at)}
            </Text>
            {post.reading_time && (
              <Text className="text-base text-gray-600 font-medium">
                {post.reading_time} min read
              </Text>
            )}
          </View>

          {/* Category-Specific Sections */}
          {hasStockData() && renderStockSection()}

          {/* Full Content */}
          <View className="mb-8">
            <Text className="text-lg text-gray-800 leading-7 font-normal">
              {post.content}
            </Text>
          </View>

          {/* Additional content sections can go here */}
          
          {/* Bottom spacing for safe scrolling */}
          <View className="h-20" />
        </View>
      </ScrollView>
    </Modal>
  );
};