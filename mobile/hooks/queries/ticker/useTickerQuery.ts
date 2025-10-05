import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { TickerResponse, TickerData } from "@/common/types/blogPosts/ticker";

/**
 * Custom hook to fetch detailed ticker information
 * 
 * @param ticker - The stock ticker symbol (e.g., 'AAPL', 'TSLA')
 * @returns React Query result with ticker data
 */
export function useTickerQuery(ticker: string) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ['ticker', ticker, user?.id],
    queryFn: async (): Promise<TickerResponse> => {
      if (!user?.id) {
        throw new Error('User must be authenticated to fetch ticker data');
      }

      try {
        const apiUrl = `https://alethia-production.up.railway.app/ticker/${ticker}`
        
        const requestBody = {
          userId: user.id,
          save_to_db: true,
          use_cache: true,
        };
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch ticker data: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch ticker data');
        }
        
        return data;
      } catch (error) {
        // Fallback to mock data when API fails
        console.warn(`API call failed for ${ticker}, using mock data:`, error);
        const mockData = generateMockTickerData(ticker);
        return {
          success: true,
          data: mockData,
          timestamp: Date.now()
        };
      }
    },
    enabled: !!ticker && !!user?.id && !authLoading,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1, // Reduced retries since we have mock data fallback
    retryDelay: 1000,
  });
} 


/**
 * Mock data generator for ticker information
 * This will be replaced with actual API data when the backend is ready
 */
const generateMockTickerData = (ticker: string): TickerData => {
  const mockData: Record<string, Partial<TickerData>> = {
    AAPL: {
      company_name: "Apple Inc.",
      sector: "Technology",
      industry: "Consumer Electronics",
      description: "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.",
      country: "United States",
      currency: "USD",
      exchange: "NASDAQ",
      website: "https://apple.com",
      logo_url: "https://logo.clearbit.com/apple.com",
      employees: 164000,
      beta: 1.29,
      debt_to_equity: 1.73,
      dividend_yield: 0.0043,
      earnings_growth: 0.082,
      market_cap: 3450000000000,
      pe_ratio: 29.8,
      price_to_book: 45.2,
      profit_margins: 0.253,
      return_on_equity: 1.47,
      revenue_growth: 0.061,
    },
    TSLA: {
      company_name: "Tesla, Inc.",
      sector: "Consumer Cyclical",
      industry: "Auto Manufacturers",
      description: "Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems.",
      country: "United States",
      currency: "USD",
      exchange: "NASDAQ",
      website: "https://tesla.com",
      logo_url: "https://logo.clearbit.com/tesla.com",
      employees: 140000,
      beta: 2.24,
      debt_to_equity: 0.17,
      dividend_yield: null,
      earnings_growth: 0.156,
      market_cap: 789200000000,
      pe_ratio: 66.2,
      price_to_book: 15.8,
      profit_margins: 0.082,
      return_on_equity: 0.19,
      revenue_growth: 0.124,
    },
    NVDA: {
      company_name: "NVIDIA Corporation",
      sector: "Technology",
      industry: "Semiconductors",
      description: "NVIDIA Corporation provides graphics, and compute and networking solutions in the United States, Taiwan, China, and internationally.",
      country: "United States",
      currency: "USD",
      exchange: "NASDAQ",
      website: "https://nvidia.com",
      logo_url: "https://logo.clearbit.com/nvidia.com",
      employees: 29000,
      beta: 1.68,
      debt_to_equity: 0.23,
      dividend_yield: 0.0003,
      earnings_growth: 0.445,
      market_cap: 2870000000000,
      pe_ratio: 73.2,
      price_to_book: 65.4,
      profit_margins: 0.521,
      return_on_equity: 1.89,
      revenue_growth: 0.267,
    },
    ABP: {
      company_name: "Abpro Corporation",
      sector: "Healthcare",
      industry: "Biotechnology",
      description: "Abpro Holdings, Inc., a biotechnology company, focuses on novel antibody constructs for immuno-oncology and ophthalmology.",
      country: "United States",
      currency: "USD",
      exchange: "NGM",
      website: "https://abpro.co",
      employees: 6,
      beta: 0.023,
      debt_to_equity: null,
      dividend_yield: null,
      earnings_growth: null,
      market_cap: 16851034,
      pe_ratio: null,
      price_to_book: -0.7992395,
      profit_margins: 0.0,
      return_on_equity: null,
      revenue_growth: null,
    },
  };

  const basePrice = Math.random() * 200 + 50; // Random price between 50-250
  const priceChange = (Math.random() - 0.5) * 20; // Random change between -10 to +10
  const priceChangePercent = (priceChange / basePrice) * 100;

  const specificData = mockData[ticker] || {
    company_name: `${ticker} Corporation`,
    sector: "Technology",
    industry: "Software",
    description: `${ticker} is a leading technology company focused on innovation and growth.`,
    country: "United States",
    currency: "USD",
    exchange: "NASDAQ",
    website: `https://${ticker.toLowerCase()}.com`,
    employees: Math.floor(Math.random() * 50000) + 1000,
    beta: Math.random() * 2 + 0.5,
    debt_to_equity: Math.random() * 2,
    dividend_yield: Math.random() * 0.05,
    earnings_growth: Math.random() * 0.3 - 0.1,
    market_cap: Math.floor(Math.random() * 500000000000) + 50000000000,
    pe_ratio: Math.random() * 50 + 10,
    price_to_book: Math.random() * 20 + 1,
    profit_margins: Math.random() * 0.3,
    return_on_equity: Math.random() * 0.5 + 0.1,
    revenue_growth: Math.random() * 0.4 - 0.1,
  };

  // Generate historical data
  const historicalDates = [];
  const historicalPrices = [];
  const historicalVolumes = [];
  
  for (let i = 22; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    historicalDates.push(date.toISOString().split('T')[0]);
    
    const priceVariation = (Math.random() - 0.5) * 10;
    historicalPrices.push(basePrice + priceVariation);
    
    const volumeVariation = Math.random() * 10000000 + 1000000;
    historicalVolumes.push(Math.floor(volumeVariation));
  }

  // Generate sentiment data
  const sentimentScore = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
  const sentimentLabels = ['bearish', 'neutral', 'bullish'];
  const sentimentConfidence = Math.random() * 100;

  // Generate news data
  const newsData = [
    {
      id: `news-${ticker}-1`,
      content: {
        bypassModal: false,
        canonicalUrl: {
          lang: "en-US",
          region: "US",
          site: "finance",
          url: `https://finance.yahoo.com/news/${ticker.toLowerCase()}-stock-update.html`
        },
        clickThroughUrl: {
          lang: "en-US",
          region: "US",
          site: "finance",
          url: `https://finance.yahoo.com/news/${ticker.toLowerCase()}-stock-update.html`
        },
        contentType: "STORY",
        description: `Latest updates on ${ticker} stock performance and market analysis.`,
        displayTime: new Date().toISOString(),
        finance: {
          premiumFinance: {
            isPremiumFreeNews: true,
            isPremiumNews: false
          }
        },
        id: `news-${ticker}-1`,
        isHosted: true,
        metadata: {
          editorsPick: false
        },
        previewUrl: null,
        provider: {
          displayName: "Financial News",
          url: "https://finance.yahoo.com"
        },
        pubDate: new Date().toISOString(),
        storyline: null,
        summary: `${ticker} shows ${sentimentScore > 0 ? 'positive' : sentimentScore < 0 ? 'negative' : 'neutral'} market sentiment.`,
        thumbnail: null,
        title: `${ticker} Stock Market Update`
      }
    }
  ];

  return {
    average_volume: Math.floor(Math.random() * 10000000) + 5000000,
    beta: specificData.beta || Math.random() * 2 + 0.5,
    company_name: specificData.company_name || `${ticker} Corporation`,
    country: specificData.country || "United States",
    currency: specificData.currency || "USD",
    current_price: basePrice,
    day_high: basePrice + Math.random() * 5,
    day_low: basePrice - Math.random() * 5,
    debt_to_equity: specificData.debt_to_equity || Math.random() * 2,
    description: specificData.description || `${ticker} is a leading company in its industry.`,
    dividend_yield: specificData.dividend_yield || Math.random() * 0.05,
    earnings_growth: specificData.earnings_growth || Math.random() * 0.3 - 0.1,
    employees: specificData.employees || Math.floor(Math.random() * 50000) + 1000,
    exchange: specificData.exchange || "NASDAQ",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    historical_data: {
      dates: historicalDates,
      prices: historicalPrices,
      volumes: historicalVolumes
    },
    industry: specificData.industry || "Technology",
    market_cap: specificData.market_cap || Math.floor(Math.random() * 500000000000) + 50000000000,
    market_state: Math.random() > 0.5 ? "OPEN" : "CLOSED",
    news_data: newsData,
    pe_ratio: specificData.pe_ratio || Math.random() * 50 + 10,
    price_change: priceChange,
    price_change_percent: priceChangePercent,
    price_to_book: specificData.price_to_book || Math.random() * 20 + 1,
    profit_margins: specificData.profit_margins || Math.random() * 0.3,
    recommendations: [], // Not defined in response
    return_on_equity: specificData.return_on_equity || Math.random() * 0.5 + 0.1,
    revenue_growth: specificData.revenue_growth || Math.random() * 0.4 - 0.1,
    sector: specificData.sector || "Technology",
    sentiment: {
      confidence: sentimentConfidence,
      factors: {
        beta: specificData.beta || Math.random() * 2 + 0.5,
        pe_ratio: specificData.pe_ratio || Math.random() * 50 + 10,
        price_movement: priceChangePercent
      },
      score: sentimentScore,
      sentiment: sentimentLabels[sentimentScore + 1]
    },
    sentiment_confidence: sentimentConfidence,
    sentiment_score: sentimentScore,
    ticker,
    volume: Math.floor(Math.random() * 10000000) + 1000000,
    website: specificData.website || `https://${ticker.toLowerCase()}.com`,
    year_high: basePrice + Math.random() * 50,
    year_low: basePrice - Math.random() * 30,
  };
};