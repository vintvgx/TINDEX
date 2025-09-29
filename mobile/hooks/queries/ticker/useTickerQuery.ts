import { useQuery } from "@tanstack/react-query";
import { TickerResponse, TickerData } from "@/common/types/blogPosts/ticker";

/**
 * Mock data generator for ticker information
 * This will be replaced with actual API data when the backend is ready
 */
const generateMockTickerData = (ticker: string): TickerData => {
  const mockData: Record<string, Partial<TickerData>> = {
    AAPL: {
      companyName: "Apple Inc.",
      sector: "Technology",
      industry: "Consumer Electronics",
      description: "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.",
      marketCap: "3.45T",
      enterpriseValue: "3.42T",
      peRatio: "29.8x",
      evEbitda: "24.1x",
      dividendYield: "0.43%",
      eps: "6.16",
      beta: 1.29,
    },
    TSLA: {
      companyName: "Tesla, Inc.",
      sector: "Consumer Cyclical",
      industry: "Auto Manufacturers",
      description: "Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems.",
      marketCap: "789.2B",
      enterpriseValue: "776.8B",
      peRatio: "66.2x",
      evEbitda: "45.8x",
      dividendYield: "0.00%",
      eps: "4.30",
      beta: 2.24,
    },
    NVDA: {
      companyName: "NVIDIA Corporation",
      sector: "Technology",
      industry: "Semiconductors",
      description: "NVIDIA Corporation provides graphics, and compute and networking solutions in the United States, Taiwan, China, and internationally.",
      marketCap: "2.87T",
      enterpriseValue: "2.84T",
      peRatio: "73.2x",
      evEbitda: "54.7x",
      dividendYield: "0.03%",
      eps: "15.40",
      beta: 1.68,
    },
  };

  const basePrice = Math.random() * 200 + 50; // Random price between 50-250
  const change = (Math.random() - 0.5) * 20; // Random change between -10 to +10
  const changePercent = (change / basePrice) * 100;

  const specificData = mockData[ticker] || {
    companyName: `${ticker} Corporation`,
    sector: "Technology",
    industry: "Software",
    description: `${ticker} is a leading technology company focused on innovation and growth.`,
    marketCap: `${(Math.random() * 500 + 50).toFixed(1)}B`,
    enterpriseValue: `${(Math.random() * 520 + 45).toFixed(1)}B`,
    peRatio: `${(Math.random() * 50 + 10).toFixed(1)}x`,
    evEbitda: `${(Math.random() * 40 + 15).toFixed(1)}x`,
    dividendYield: `${(Math.random() * 3).toFixed(2)}%`,
    eps: `${(Math.random() * 10 + 1).toFixed(2)}`,
    beta: Math.random() * 2 + 0.5,
  };

  return {
    ticker,
    price: basePrice,
    change,
    changePercent,
    volume: `${(Math.random() * 100 + 10).toFixed(1)}M`,
    dayHigh: basePrice + Math.random() * 5,
    dayLow: basePrice - Math.random() * 5,
    yearHigh: basePrice + Math.random() * 50,
    yearLow: basePrice - Math.random() * 30,
    avgVolume: `${(Math.random() * 50 + 20).toFixed(1)}M`,
    ...specificData,
    analystRecommendations: {
      strongSell: Math.floor(Math.random() * 5),
      sell: Math.floor(Math.random() * 8),
      hold: Math.floor(Math.random() * 15) + 5,
      buy: Math.floor(Math.random() * 12) + 3,
      strongBuy: Math.floor(Math.random() * 8) + 2,
    },
    priceTarget: {
      average: basePrice * (1 + (Math.random() - 0.3) * 0.4), // ±40% from current price
      volatility: Math.random() * 50 + 20, // 20-70% volatility
    },
    events: [
      { date: "10/25/25", event: "Q3 2025 Earnings Release" },
      { date: "1/24/26", event: "Q4 2025 Earnings Release" },
      { date: "4/25/26", event: "Annual Shareholder Meeting" },
    ],
    earnings: {
      quarter: "Q2 '25",
      summary: `${ticker}'s Q2 2025 results show strong performance with revenue growth driven by increased demand and strategic initiatives.`,
    },
    chartData: {
      labels: ["Sep 19", "Sep 20", "Sep 21", "Sep 22", "Sep 23"],
      prices: Array.from({ length: 5 }, (_, i) => basePrice + (Math.random() - 0.5) * 10),
    },
  } as TickerData;
};

/**
 * Custom hook to fetch detailed ticker information
 * 
 * @param ticker - The stock ticker symbol (e.g., 'AAPL', 'TSLA')
 * @returns React Query result with ticker data
 */
export function useTickerQuery(ticker: string) {
  return useQuery({
    queryKey: ['ticker', ticker],
    queryFn: async (): Promise<TickerResponse> => {
      // Mock API endpoint - replace with actual API when ready
      const mockApiUrl = `https://api.alethia.com/v1/ticker/${ticker}`;
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // For now, return mock data
      // When the real API is ready, uncomment the following:
      /*
      const response = await fetch(mockApiUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch ticker data: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch ticker data');
      }
      
      return data;
      */
      
      // Mock response
      return {
        success: true,
        data: generateMockTickerData(ticker),
        timestamp: Date.now(),
      };
    },
    enabled: !!ticker,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 2,
    retryDelay: 1000,
  });
} 