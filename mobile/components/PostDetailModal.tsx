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
import { StockResearchData } from '@/types/categories/stocks/stock_types';
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
    console.log("Has stock data: ", (post.topics?.category === 'stocks' && post.research_data?.alphaVantageData))
    console.log("Post topics cat:", post.topics?.category)
    console.log("POst:", post)
    return post.topics?.category === 'stocks' && post.research_data?.alphaVantageData;
  };

  // Get stock data from research_data
  const getStockData = (): StockResearchData | null => {
    if (!hasStockData()) return null;
    return post.research_data as StockResearchData;
  };

  // Format stock price with proper styling
  const formatStockPrice = (price: string, change: string, changePercent: string) => {
    const isPositive = parseFloat(change) >= 0;
    const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
    const changeIcon = isPositive ? 'trending-up' : 'trending-down';
    
    return (
      <View className="flex-row items-center">
        <Text className="text-2xl font-bold text-gray-900">${price}</Text>
        <View className="flex-row items-center ml-3">
          <Ionicons 
            name={changeIcon as any} 
            size={20} 
            color={isPositive ? '#059669' : '#dc2626'} 
          />
          <Text className={`text-lg font-semibold ml-1 ${changeColor}`}>
            {change} ({changePercent})
          </Text>
        </View>
      </View>
    );
  };

  // Render comprehensive stock information section
  const renderStockSection = () => {
    const stockData = getStockData();
    if (!stockData?.alphaVantageData?.realTimeData?.['Global Quote']) return null;

    const quote = stockData.alphaVantageData.realTimeData['Global Quote'];
    const company = stockData.alphaVantageData.companyOverview;
    const news = stockData.alphaVantageData.recentNews?.feed || [];

    return (
      <View className="mb-8">
        {/* Stock Header */}
        <View className="mb-6">
          <View className="flex-row justify-between items-start mb-4">
            <View className="flex-1">
              <Text className="text-3xl font-bold text-gray-900">
                {quote['01. symbol']}
              </Text>
              <Text className="text-lg text-gray-600 mt-1">
                {company?.Name || 'Stock Information'}
              </Text>
            </View>
            <View className="bg-blue-100 px-3 py-2 rounded-full">
              <Text className="text-sm text-blue-700 font-semibold">
                STOCK
              </Text>
            </View>
          </View>

          {/* Price and Change */}
          <View className="mb-6">
            {formatStockPrice(
              quote['05. price'],
              quote['09. change'],
              quote['10. change percent']
            )}
          </View>
        </View>

        {/* Key Metrics Grid */}
        <View className="mb-6">
          <Text className="text-xl font-bold text-gray-900 mb-4">Key Metrics</Text>
          <View className="bg-gray-50 rounded-xl p-4">
            <View className="flex-row flex-wrap">
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">Volume</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {parseInt(quote['06. volume']).toLocaleString()}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">Market Cap</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  {company?.MarketCapitalization ? 
                    `$${(parseInt(company.MarketCapitalization) / 1000000).toFixed(1)}M` : 
                    'N/A'
                  }
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">52W High</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  ${company?.['52WeekHigh'] || 'N/A'}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">52W Low</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  ${company?.['52WeekLow'] || 'N/A'}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">50D MA</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  ${company?.['50DayMovingAverage'] || 'N/A'}
                </Text>
              </View>
              <View className="w-1/2 mb-4">
                <Text className="text-sm text-gray-500 mb-1">200D MA</Text>
                <Text className="text-lg font-semibold text-gray-900">
                  ${company?.['200DayMovingAverage'] || 'N/A'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Company Information */}
        {company && (
          <View className="mb-6">
            <Text className="text-xl font-bold text-gray-900 mb-4">Company Overview</Text>
            <View className="bg-gray-50 rounded-xl p-4">
              <Text className="text-base text-gray-800 leading-6 mb-3">
                {company.Description}
              </Text>
              
              <View className="flex-row flex-wrap">
                <View className="w-1/2 mb-3">
                  <Text className="text-sm text-gray-500 mb-1">Sector</Text>
                  <Text className="text-base font-semibold text-gray-900">
                    {company.Sector}
                  </Text>
                </View>
                <View className="w-1/2 mb-3">
                  <Text className="text-sm text-gray-500 mb-1">Industry</Text>
                  <Text className="text-base font-semibold text-gray-900">
                    {company.Industry}
                  </Text>
                </View>
                <View className="w-1/2 mb-3">
                  <Text className="text-sm text-gray-500 mb-1">Exchange</Text>
                  <Text className="text-base font-semibold text-gray-900">
                    {company.Exchange}
                  </Text>
                </View>
                <View className="w-1/2 mb-3">
                  <Text className="text-sm text-gray-500 mb-1">Beta</Text>
                  <Text className="text-base font-semibold text-gray-900">
                    {company.Beta || 'N/A'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Recent News */}
        {news.length > 0 && (
          <View className="mb-6">
            <Text className="text-xl font-bold text-gray-900 mb-4">Recent News</Text>
            <View className="space-y-3">
              {news.slice(0, 3).map((item, index) => (
                <View key={index} className="bg-gray-50 rounded-xl p-4">
                  <Text className="text-base font-semibold text-gray-900 mb-2" numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text className="text-sm text-gray-600 mb-2" numberOfLines={3}>
                    {item.summary}
                  </Text>
                  <View className="flex-row justify-between items-center">
                    <Text className="text-xs text-gray-500">
                      {new Date(item.time_published).toLocaleDateString()}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {item.source}
                    </Text>
                  </View>
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
          {post.topics && (
            <View className="flex-row flex-wrap mb-4">
              <View className="bg-blue-100 px-3 py-1.5 rounded-full">
                <Text className="text-sm text-blue-700 font-semibold">
                  {post.topics.name}
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