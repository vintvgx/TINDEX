
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
  