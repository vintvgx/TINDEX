// Stock-related types based on the research data structure

export interface StockKeyFact {
  id: string;
  title: string;
  value: string;
  description?: string;
}

export interface StockStatistic {
  id: string;
  name: string;
  value: string | number;
  unit?: string;
  change?: string;
  changePercent?: string;
}

export interface SerpApiMetadata {
  id: string;
  status: string;
  created_at: string;
  google_url: string;
  processed_at: string;
  json_endpoint: string;
  raw_html_file: string;
  total_time_taken: number;
  pixel_position_endpoint: string;
}

export interface SerpApiSitelink {
  link: string;
  title: string;
}

export interface SerpApiOrganicResult {
  link: string;
  title: string;
  source: string;
  favicon: string;
  snippet: string;
  position: number;
  sitelinks?: {
    inline: SerpApiSitelink[];
  };
  redirect_link?: string;
  displayed_link: string;
  snippet_highlighted_words: string[];
}

export interface SerpApiData {
  title: string;
  status: string;
  metadata: SerpApiMetadata;
  organicResults: SerpApiOrganicResult[];
}

export interface NewsArticle {
  url: string;
  title: string;
  author: string;
  source: {
    id: string | null;
    name: string;
  };
  content: string;
  urlToImage: string | null;
  description: string;
  publishedAt: string;
}

export interface NewsArticlesData {
  status: string;
  articles: NewsArticle[];
  totalResults: number;
}

export interface TrendingInfo {
  id: string;
  title: string;
  description: string;
  value: string | number;
  change?: string;
  changePercent?: string;
}

// Polygon.io Types
export interface PolygonAddress {
  address1: string;
  city: string;
  state: string;
  postal_code: string;
}

export interface PolygonBranding {
  logo_url: string;
  icon_url: string;
}

export interface PolygonTickerDetails {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange: string;
  type: string;
  active: boolean;
  currency_name: string;
  cik: string;
  composite_figi: string;
  share_class_figi: string;
  market_cap: number;
  phone_number: string;
  address: PolygonAddress;
  description: string;
  sic_code: string;
  sic_description: string;
  ticker_root: string;
  homepage_url: string;
  total_employees: number;
  list_date: string;
  branding: PolygonBranding;
  share_class_shares_outstanding: number;
  weighted_shares_outstanding: number;
  round_lot: number;
}

export interface PolygonPublisher {
  name: string;
  homepage_url: string;
  logo_url: string;
  favicon_url: string;
}

export interface PolygonNewsInsight {
  ticker: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_reasoning: string;
}

export interface PolygonNewsArticle {
  id: string;
  publisher: PolygonPublisher;
  title: string;
  author: string;
  published_utc: string;
  article_url: string;
  tickers: string[];
  image_url: string;
  description: string;
  keywords: string[];
  insights: PolygonNewsInsight[];
  amp_url?: string;
}

export interface PolygonDailyBar {
  c: number; // Close price
  h: number; // High price
  l: number; // Low price
  n: number; // Number of transactions
  o: number; // Open price
  t: number; // Timestamp
  v: number; // Volume
  vw: number; // Volume weighted average price
}

export interface PolygonData {
  tickerDetails: PolygonTickerDetails;
  recentNews: PolygonNewsArticle[];
  dailyBars: PolygonDailyBar[];
  previousClose: PolygonDailyBar | null;
  error: string | null;
}

// AlphaVantage Types (existing)
export interface AlphaVantageTopic {
  topic: string;
  relevance_score: string;
}

export interface AlphaVantageTickerSentiment {
  ticker: string;
  relevance_score: string;
  ticker_sentiment_score: string;
  ticker_sentiment_label: string;
}

export interface AlphaVantageNewsItem {
  title: string;
  url: string;
  time_published: string;
  authors: string[];
  summary: string;
  banner_image: string;
  source: string;
  category_within_source: string;
  source_domain: string;
  topics: AlphaVantageTopic[];
  overall_sentiment_score: number;
  overall_sentiment_label: string;
  ticker_sentiment: AlphaVantageTickerSentiment[];
}

export interface AlphaVantageRecentNews {
  items: string;
  sentiment_score_definition: string;
  relevance_score_definition: string;
  feed: AlphaVantageNewsItem[];
}

export interface AlphaVantageGlobalQuote {
  "01. symbol": string;
  "02. open": string;
  "03. high": string;
  "04. low": string;
  "05. price": string;
  "06. volume": string;
  "07. latest trading day": string;
  "08. previous close": string;
  "09. change": string;
  "10. change percent": string;
}

export interface AlphaVantageRealTimeData {
  "Global Quote": AlphaVantageGlobalQuote;
}

export interface AlphaVantageCompanyOverview {
  Symbol: string;
  AssetType: string;
  Name: string;
  Description: string;
  CIK: string;
  Exchange: string;
  Currency: string;
  Country: string;
  Sector: string;
  Industry: string;
  Address: string;
  OfficialSite: string;
  FiscalYearEnd: string;
  LatestQuarter: string;
  MarketCapitalization: string;
  EBITDA: string;
  PERatio: string;
  PEGRatio: string;
  BookValue: string;
  DividendPerShare: string;
  DividendYield: string;
  EPS: string;
  RevenuePerShareTTM: string;
  ProfitMargin: string;
  OperatingMarginTTM: string;
  ReturnOnAssetsTTM: string;
  ReturnOnEquityTTM: string;
  RevenueTTM: string;
  GrossProfitTTM: string;
  DilutedEPSTTM: string;
  QuarterlyEarningsGrowthYOY: string;
  QuarterlyRevenueGrowthYOY: string;
  AnalystTargetPrice: string;
  AnalystRatingStrongBuy: string;
  AnalystRatingBuy: string;
  AnalystRatingHold: string;
  AnalystRatingSell: string;
  AnalystRatingStrongSell: string;
  TrailingPE: string;
  ForwardPE: string;
  PriceToSalesRatioTTM: string;
  PriceToBookRatio: string;
  EVToRevenue: string;
  EVToEBITDA: string;
  Beta: string;
  "52WeekHigh": string;
  "52WeekLow": string;
  "50DayMovingAverage": string;
  "200DayMovingAverage": string;
  SharesOutstanding: string;
  SharesFloat: string;
  PercentInsiders: string;
  PercentInstitutions: string;
  DividendDate: string;
  ExDividendDate: string;
}

export interface AlphaVantageData {
  error: string | null;
  recentNews: AlphaVantageRecentNews;
  realTimeData: AlphaVantageRealTimeData;
  companyOverview: AlphaVantageCompanyOverview;
}

export interface RecentDevelopment {
  id: string;
  title: string;
  description: string;
  date: string;
  impact: 'positive' | 'negative' | 'neutral';
  source: string;
}

// Main stock research data structure
export interface StockResearchData {
  keyFacts: StockKeyFact[];
  statistics: StockStatistic[];
  serpApiData: SerpApiData;
  newsArticles: NewsArticlesData;
  trendingInfo: TrendingInfo[];
  alphaVantageData: AlphaVantageData;
  polygonData: PolygonData;
  recentDevelopments: RecentDevelopment[];
}

// Stock display data for UI components
export interface StockDisplayData {
  symbol: string;
  companyName: string;
  currentPrice: string;
  change: string;
  changePercent: string;
  volume: string;
  marketCap: string;
  sector: string;
  industry: string;
  description: string;
  priceRange: {
    high: string;
    low: string;
  };
  movingAverages: {
    day50: string;
    day200: string;
  };
  analystRating: {
    targetPrice: string;
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  };
  keyMetrics: {
    peRatio: string;
    eps: string;
    beta: string;
    dividendYield: string;
  };
}
