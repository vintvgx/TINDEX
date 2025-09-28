/**
 * Contains types for ticker information throughout UI.
 */

export interface TickerData {
  ticker: string;
  companyName: string;
  price: number;
  change: number;
  changePercent: number;
  sector: string;
  industry: string;
  logo?: string;
  marketCap?: string;
  enterpriseValue?: string;
  peRatio?: string;
  evEbitda?: string;
  dividendYield?: string;
  eps?: string;
  description?: string;
  volume?: string;
  dayHigh?: number;
  dayLow?: number;
  yearHigh?: number;
  yearLow?: number;
  avgVolume?: string;
  beta?: number;
  analystRecommendations?: {
    strongSell: number;
    sell: number;
    hold: number;
    buy: number;
    strongBuy: number;
  };
  priceTarget?: {
    average: number;
    volatility: number;
  };
  events?: Array<{
    date: string;
    event: string;
  }>;
  earnings?: {
    quarter: string;
    summary: string;
  };
  chartData?: {
    labels: string[];
    prices: number[];
  };
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

