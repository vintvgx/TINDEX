import React from 'react';
import { View, Text } from 'react-native';
import { BlogPostType } from '@/types';
import { StockResearchData } from '@/types/categories/stocks/stock_types';
import { Ionicons } from '@expo/vector-icons';

interface CategorySectionsProps {
  post: BlogPostType;
  variant?: 'card' | 'modal';
}

/**
 * CategorySections Component
 * 
 * Handles rendering of category-specific content sections for blog posts.
 * Supports different variants for card and modal displays.
 * 
 * Architecture Decision: Single component with category-specific renderers
 * - Maintains consistency across all categories
 * - Easy to extend with new categories
 * - Centralized category logic
 * - Reusable across different contexts
 */
export const CategorySections: React.FC<CategorySectionsProps> = ({ 
  post, 
  variant = 'card' 
}) => {
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
  const formatStockPrice = (price: string, change: string, changePercent: string, size: 'small' | 'large' = 'small') => {
    const isPositive = parseFloat(change) >= 0;
    const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
    const changeIcon = isPositive ? 'trending-up' : 'trending-down';
    
    const priceSize = size === 'large' ? 'text-2xl' : 'text-lg';
    const changeSize = size === 'large' ? 'text-lg' : 'text-sm';
    const iconSize = size === 'large' ? 20 : 16;
    const marginLeft = size === 'large' ? 'ml-3' : 'ml-2';
    
    return (
      <View className="flex-row items-center">
        <Text className={`${priceSize} font-bold text-gray-900`}>${price}</Text>
        <View className={`flex-row items-center ${marginLeft}`}>
          <Ionicons 
            name={changeIcon as any} 
            size={iconSize} 
            color={isPositive ? '#059669' : '#dc2626'} 
          />
          <Text className={`${changeSize} font-semibold ml-1 ${changeColor}`}>
            {change} ({changePercent})
          </Text>
        </View>
      </View>
    );
  };

  // Render stock section for card variant
  const renderStockCard = () => {
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
            quote['10. change percent'],
            'small'
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

  // Render stock section for modal variant
  const renderStockModal = () => {
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
              quote['10. change percent'],
              'large'
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

  // Render sports section (placeholder for future implementation)
  const renderSportsSection = () => {
    // TODO: Implement sports-specific content
    return null;
  };

  // Render news section (placeholder for future implementation)
  const renderNewsSection = () => {
    // TODO: Implement news-specific content
    return null;
  };

  // Render science section (placeholder for future implementation)
  const renderScienceSection = () => {
    // TODO: Implement science-specific content
    return null;
  };

  // Render technology section (placeholder for future implementation)
  const renderTechnologySection = () => {
    // TODO: Implement technology-specific content
    return null;
  };

  // Main render function based on category and variant
  const renderCategorySection = () => {
    const category = post.topics?.category;

    switch (category) {
      case 'stocks':
        return variant === 'card' ? renderStockCard() : renderStockModal();
      case 'sports':
        return renderSportsSection();
      case 'news':
        return renderNewsSection();
      case 'science':
        return renderScienceSection();
      case 'technology':
        return renderTechnologySection();
      default:
        return null;
    }
  };

  return renderCategorySection();
}; 