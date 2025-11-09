/**
 * Contains types for ticker information throughout UI.
 */

export interface TickerData {
  average_volume: number;
  beta: number;
  company_name: string;
  country: string;
  currency: string;
  current_price: number;
  day_high: number;
  day_low: number;
  debt_to_equity: number | null;
  description: string;
  dividend_yield: number | null;
  earnings_growth: number | null;
  employees: number;
  exchange: string;
  expires_at: string;
  has_options?: boolean;
  historical_data: {
    dates: string[];
    prices: number[];
    volumes: number[];
  };
  industry: string;
  logo_url?: string;
  market_cap: number;
  market_state: string;
  news_data: {
    content: {
      bypassModal: boolean;
      canonicalUrl: {
        lang: string;
        region: string;
        site: string;
        url: string;
      };
      clickThroughUrl: {
        lang: string;
        region: string;
        site: string;
        url: string;
      };
      contentType: string;
      description: string;
      displayTime: string;
      finance: {
        premiumFinance: {
          isPremiumFreeNews: boolean;
          isPremiumNews: boolean;
        };
      };
      id: string;
      isHosted: boolean;
      metadata: {
        editorsPick: boolean;
      };
      previewUrl: string | null;
      provider: {
        displayName: string;
        url: string;
      };
      pubDate: string;
      storyline: string | null;
      summary: string;
      thumbnail: string | null;
      title: string;
    };
    id: string;
  }[];
  options_analysis?: {
    has_opportunities: boolean;
    market_context: {
      beta: number;
      current_price: number;
      price_change_pct: number;
      sentiment: {
        confidence: number;
        factors: {
          beta: number;
          pe_ratio: number | null;
          price_movement: number;
        };
        score: number;
        sentiment: string;
      };
      sentiment_score: number;
      volume_ratio: number;
    };
    opportunities: OptionsOpportunity[];
    summary: {
      avg_spread_pct: number;
      avg_volume: number;
      avoid_signals: number;
      buy_signals: number;
      consider_signals: number;
      total_analyzed: number;
    };
  };
  pe_ratio: number | null;
  price_change: number;
  price_change_percent: number;
  price_to_book: number;
  profit_margins: number;
  recommendations: any[];
  return_on_equity: number | null;
  revenue_growth: number | null;
  sector: string;
  sentiment: {
    confidence: number;
    factors: {
      beta: number;
      pe_ratio: number | null;
      price_movement: number;
    };
    score: number;
    sentiment: string;
  };
  sentiment_confidence: number;
  sentiment_score: number;
  ticker: string;
  top_option_score?: number;
  top_option_signal?: string;
  volume: number;
  website: string;
  year_high: number;
  year_low: number;
}

export interface OptionsOpportunity {
  ask: number;
  bid: number;
  contractSymbol: string;
  delta: number | null;
  dte: number;
  expirationDate: string;
  extrinsicValue: number;
  gamma: number | null;
  impliedVolatility: number;
  intrinsicValue: number;
  mark: number;
  moneyness: number;
  openInterest: number;
  optionType: "CALL" | "PUT";
  reasons: string;
  score_breakdown?: {
    greeks: number;
    liquidity: number;
    momentum: number;
    sentiment: number;
    value: number;
    volume: number;
  };
  signal: "BUY" | "CONSIDER" | "AVOID";
  signal_color?: "GREEN" | "YELLOW" | "RED";
  spreadPct: number;
  strike: number;
  theta: number | null;
  total_score: number;
  vega: number | null;
  volume: number;
}

// export interface TickerResponse {
//   success: boolean;
//   data: TickerData;
//   timestamp: number;
//   error?: string;
// }

/**
 * Ticker Response defined as a union
 *  - success: true = returns TickerData
 *  - success: false = returns error string and potential data
 */
export type TickerResponse =
  | { success: true; data: TickerData; timestamp: number }
  | { success: false; error: string; timestamp: number; data?: undefined };

export interface TickerViewProps {
  ticker: string;
}
