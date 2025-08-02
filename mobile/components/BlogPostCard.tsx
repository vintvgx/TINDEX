import React, { useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { Card, CardContent } from './ui/card';
import { BlogPostType } from '@/types';
import { StockResearchData } from '@/types/categories/stocks/stock_types';
import { Ionicons } from '@expo/vector-icons';

interface BlogPostCardProps {
  post: BlogPostType;
  onPress?: (post: BlogPostType) => void;
}

export const BlogPostCard: React.FC<BlogPostCardProps> = ({ post, onPress }) => {
  const [imageError, setImageError] = useState(false);

  // Extract image URL from multimedia_data or use a placeholder
  const getImageUrl = () => {
    if (imageError) {
      return 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop';
    }
    if (post.multimedia_data?.images?.[0]?.url) {
      return post.multimedia_data.images[0].url;
    }
    if (post.multimedia_data?.featured_image) {
      return post.multimedia_data.featured_image;
    }
    // Fallback to a placeholder image
    return 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop';
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Truncate content for preview
  const truncateContent = (content: string, maxLength: number = 120) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + '...';
  };

  // Check if post has stock research data
  const hasStockData = (): boolean => {
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
        <Text className="text-lg font-bold text-gray-900">${price}</Text>
        <View className="flex-row items-center ml-2">
          <Ionicons 
            name={changeIcon as any} 
            size={16} 
            color={isPositive ? '#059669' : '#dc2626'} 
          />
          <Text className={`text-sm font-semibold ml-1 ${changeColor}`}>
            {change} ({changePercent})
          </Text>
        </View>
      </View>
    );
  };

  // Render stock information section
  const renderStockSection = () => {
    const stockData = getStockData();
    if (!stockData?.alphaVantageData?.realTimeData?.['Global Quote']) return null;

    const quote = stockData.alphaVantageData.realTimeData['Global Quote'];
    const company = stockData.alphaVantageData.companyOverview;

    return (
      <View className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
        {/* Stock Header */}
        <View className="flex-row justify-between items-start mb-3">
          <View className="flex-1">
            <Text className="text-lg font-bold text-gray-900">
              {quote['01. symbol']}
            </Text>
            <Text className="text-sm text-gray-600">
              {company?.Name || 'Stock Information'}
            </Text>
          </View>
          <View className="bg-blue-100 px-2 py-1 rounded-full">
            <Text className="text-xs text-blue-700 font-semibold">
              STOCK
            </Text>
          </View>
        </View>

        {/* Price and Change */}
        <View className="mb-3">
          {formatStockPrice(
            quote['05. price'],
            quote['09. change'],
            quote['10. change percent']
          )}
        </View>

        {/* Key Metrics Grid */}
        <View className="flex-row flex-wrap">
          <View className="w-1/2 mb-2">
            <Text className="text-xs text-gray-500">Volume</Text>
            <Text className="text-sm font-semibold text-gray-900">
              {parseInt(quote['06. volume']).toLocaleString()}
            </Text>
          </View>
          <View className="w-1/2 mb-2">
            <Text className="text-xs text-gray-500">Market Cap</Text>
            <Text className="text-sm font-semibold text-gray-900">
              {company?.MarketCapitalization ? 
                `$${(parseInt(company.MarketCapitalization) / 1000000).toFixed(1)}M` : 
                'N/A'
              }
            </Text>
          </View>
          <View className="w-1/2 mb-2">
            <Text className="text-xs text-gray-500">52W High</Text>
            <Text className="text-sm font-semibold text-gray-900">
              ${company?.['52WeekHigh'] || 'N/A'}
            </Text>
          </View>
          <View className="w-1/2 mb-2">
            <Text className="text-xs text-gray-500">52W Low</Text>
            <Text className="text-sm font-semibold text-gray-900">
              ${company?.['52WeekLow'] || 'N/A'}
            </Text>
          </View>
        </View>

        {/* Sector Information */}
        {company?.Sector && (
          <View className="mt-2 pt-2 border-t border-gray-200">
            <Text className="text-xs text-gray-500">Sector</Text>
            <Text className="text-sm font-medium text-gray-900">
              {company.Sector} • {company.Industry}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const handlePress = () => {
    onPress?.(post);
  };

  return (
    <Pressable
      onPress={handlePress}
      className="mb-6"
      android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: false }}
    >
      <Card className="overflow-hidden bg-white border-0 shadow-xl rounded-2xl">
        {/* Image Container */}
        <View className="relative">
          <Image
            source={{ uri: getImageUrl() }}
            className="w-full h-48"
            style={{ resizeMode: 'cover' }}
            onError={() => setImageError(true)}
          />
          {/* Gradient overlay for better text readability */}
          <View className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          {/* Subtle border overlay */}
          <View className="absolute inset-0 border border-gray-100/50" />
        </View>

        {/* Content */}
        <CardContent className="p-4">
          {/* Title */}
          <Text className="text-xl font-bold text-gray-900 mb-2 leading-6" numberOfLines={2}>
            {post.title}
          </Text>

          {/* Content Preview */}
          {post.content && (
            <Text className="text-sm text-gray-600 leading-5 mb-3" numberOfLines={3}>
              {truncateContent(post.content)}
            </Text>
          )}

          {/* Category-Specific Sections */}
          {hasStockData() && renderStockSection()}

          {/* Footer with date and reading time */}
          <View className="flex-row justify-between items-center pt-2 border-t border-gray-100 mt-3">
            <Text className="text-xs text-gray-500 font-medium">
              {formatDate(post.created_at)}
            </Text>
            {post.reading_time && (
              <Text className="text-xs text-gray-500 font-medium">
                {post.reading_time} min read
              </Text>
            )}
          </View>

          {/* Topics/Tags */}
          {post.topics && (
            <View className="flex-row flex-wrap mt-2">
              <View className="bg-blue-100 px-2 py-1 rounded-full mr-2 mb-1">
                <Text className="text-xs text-blue-700 font-medium">
                  {post.topics.name}
                </Text>
              </View>
            </View>
          )}
        </CardContent>
      </Card>
    </Pressable>
  );
};