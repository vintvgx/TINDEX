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
  historical_data: {
    dates: string[];
    prices: number[];
    volumes: number[];
  };
  industry: string;
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
  pe_ratio: number | null;
  price_change: number;
  price_change_percent: number;
  price_to_book: number;
  profit_margins: number;
  recommendations: any[]; // Not defined in response
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
  volume: number;
  website: string;
  year_high: number;
  year_low: number;
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

