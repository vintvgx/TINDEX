import { PriorityLevel } from "../../shared/types/client";


export interface StockData {
    currentPrice: number;
    previousClose: number;
    changePercent: number;
    volume: number;
    marketCap?: number;
    companyOverview?: any;
    recentNews?: any[];
    technicalData?: any;
  }

  export async function fetchStockData(
    ticker: string, 
    apiKey: string, 
    priority?: PriorityLevel
  ): Promise<StockData | null> {
    console.log(`Fetching stock data for ${ticker}...`);
    
    if (priority === PriorityLevel.DEBUG) {
      return getMockStockData(ticker);
    }
  
    try {
      // Parallel requests to Alpha Vantage
      const [currentQuote, companyOverview, recentNews] = await Promise.allSettled([
        fetchAlphaVantageQuote(ticker, apiKey),
        fetchAlphaVantageOverview(ticker, apiKey),
        fetchAlphaVantageNews(ticker, apiKey)
      ]);
  
      return {
        currentPrice: getValueFromSettled(currentQuote, 'price'),
        previousClose: getValueFromSettled(currentQuote, 'previousClose'),
        changePercent: getValueFromSettled(currentQuote, 'changePercent'),
        volume: getValueFromSettled(currentQuote, 'volume'),
        companyOverview: getValueFromSettled(companyOverview),
        recentNews: getValueFromSettled(recentNews, []),
      };
    } catch (error) {
      console.error(`Stock data fetch failed for ${ticker}:`, error);
      return null;
    }
  }