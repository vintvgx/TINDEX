
/**
 * Blog post type
 */
export interface BlogGenerationRequest {
    topicId?: string;
    topicName?: string;
    categoryName?: string;
    userId: string;
    targetLength?: number;
    priority?: PriorityLevel;
  }
  

  export enum PriorityLevel {
    DEBUG = "debug",
    LOW = "low",
    NORMAL = "normal",
    HIGH =  "high"
  }

  export interface ApiKeys {
    NEWS_API_KEY: string, // NewsApi Key
    SERP_API_KEY: string, // SerpAPI Key
    ALPHA_API_KEY: string // Alpha Vantage Key (Stocks)
    POLYGON_API_KEY: string // Polygon.io Key (Stocks)
  }

  /**
   * Alpha Vantage Company Overview Data
   */
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
    FullTimeEmployees: string;
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
    DividendDate: string;
    ExDividendDate: string;
  }

  /**
   * Alpha Vantage News Article
   */
  export interface AlphaVantageNewsArticle {
    title: string;
    url: string;
    time_published: string;
    authors: string[];
    summary: string;
    banner_image: string | null;
    source: string;
    category_within_source: string;
    source_domain: string;
    topics: string[];
    overall_sentiment_score: number;
    overall_sentiment_label: string;
    ticker_sentiment?: Array<{
      ticker: string;
      relevance_score: string;
      ticker_sentiment_score: string;
      ticker_sentiment_label: string;
    }>;
  }

  /**
   * Alpha Vantage Time Series Data Point
   */
  export interface AlphaVantageTimeSeriesDataPoint {
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
    "5. volume": string;
  }

  /**
   * Alpha Vantage Time Series Meta Data
   */
  export interface AlphaVantageTimeSeriesMetaData {
    "1. Information": string;
    "2. Symbol": string;
    "3. Last Refreshed": string;
    "4. Output Size": string;
    "5. Time Zone": string;
  }

  /**
   * Alpha Vantage Time Series Data
   */
  export interface AlphaVantageTimeSeriesData {
    "Meta Data": AlphaVantageTimeSeriesMetaData;
    "Time Series (Daily)": Record<string, AlphaVantageTimeSeriesDataPoint>;
  }

  /**
   * Alpha Vantage API Response
   * Main structure returned by fetchAlphaVantageData function
   */
  export interface AlphaVantageData {
    companyOverview: AlphaVantageCompanyOverview | null;
    recentNews: AlphaVantageNewsArticle[];
    realTimeData: AlphaVantageTimeSeriesData | null;
    error: string | null;
  }
  

  // Rate limit tracker for Polygon.io
class PolygonRateLimiter {
  private requests: number[] = [];
  private readonly maxRequests = 5;
  private readonly windowMs = 60000; // 1 minute in milliseconds

  // Check if we can make a request (but don't block it)
  canMakeRequest(): boolean {
    this.cleanOldRequests();
    return this.requests.length < this.maxRequests;
  }

  // Record a new request
  recordRequest(): void {
    this.cleanOldRequests();
    this.requests.push(Date.now());
  }

  // Get current request count in the window
  getCurrentRequestCount(): number {
    this.cleanOldRequests();
    return this.requests.length;
  }

  // Time until next available request slot (in ms)
  getTimeUntilNextSlot(): number {
    this.cleanOldRequests();
    if (this.requests.length < this.maxRequests) {
      return 0;
    }
    // Calculate time until the oldest request expires
    const oldestRequest = this.requests[0];
    const timeUntilExpiry = (oldestRequest + this.windowMs) - Date.now();
    return Math.max(0, timeUntilExpiry);
  }

  // Remove requests older than the time window
  private cleanOldRequests(): void {
    const now = Date.now();
    this.requests = this.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );
  }
}

export interface PolygonData {
  tickerDetails: PolygonTickerDetails | null;
  recentNews: PolygonNewsArticle[];
  dailyBars: PolygonDailyBar[];
  previousClose: PolygonDailyBar | null;
  error: string | null;
  rateLimitInfo?: {
    requestsUsed: number;
    requestsRemaining: number;
    timeUntilReset: number;
  };
}


// Types for Polygon.io responses
export interface PolygonTickerDetails {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange: string;
  type: string;
  active: boolean;
  currency_name: string;
  cik?: string;
  composite_figi?: string;
  share_class_figi?: string;
  market_cap?: number;
  phone_number?: string;
  address?: {
    address1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  };
  description?: string;
  sic_code?: string;
  sic_description?: string;
  ticker_root?: string;
  homepage_url?: string;
  total_employees?: number;
  list_date?: string;
  branding?: {
    logo_url?: string;
    icon_url?: string;
  };
}

export interface PolygonDailyBar {
  volume: number; // Volume
  volumeWeighted: number; // Volume weighted average price
  open: number; // Open price
  close: number; // Close price
  high: number; // High price
  low: number; // Low price
  timestamp: number | null; // Timestamp
  transactions: number; // Number of transactions
}

export interface PolygonNewsArticle {
  id: string;
  publisher: {
    name: string;
    homepage_url: string;
    logo_url: string;
    favicon_url: string;
  };
  title: string;
  author: string;
  published_utc: string;
  article_url: string;
  tickers: string[];
  image_url?: string;
  description: string;
  keywords?: string[];
  amp_url?: string;
}

