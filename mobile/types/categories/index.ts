// Category types for different blog post categories
import { StockResearchData, StockDisplayData, StockKeyFact, StockStatistic, SerpApiMetadata, SerpApiData, NewsArticle, NewsArticlesData, TrendingInfo, AlphaVantageData } from './stocks/stock_types';

// Base category interface
export interface BaseCategoryType {
  id: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
}

export interface BaseCategoryType {
    id: string;
    name: string;
    description: string;
    icon?: string;
    color?: string;
  }

export interface StockCategoryType extends BaseCategoryType {
    keyFacts: StockKeyFact,
    statistics: StockStatistic,
    serpApiData: SerpApiData,
    newsArticle: NewsArticlesData,
    trendingInfo: TrendingInfo,
    alphaVantageData: AlphaVantageData
}