export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  user_id: string;
  ticker?: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AgentChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  ticker?: string;
  contractContext?: {
    symbol: string;
    optionType: string;
    strike: number;
    expiration: string;
    currentPrice?: number;
    greeks?: Record<string, number | null | undefined>;
  };
}

export interface AgentChatResponse {
  conversationId: string;
  messageId: string;
  response: string;
  title?: string;
}

export type AgentStreamChunk = {
  type: 'chunk' | 'complete' | 'error' | 'metadata';
  content?: string;
  conversationId?: string;
  messageId?: string;
  title?: string;
  error?: string;
};

export interface ContractScoreRequest {
  userId: string;
  trackedContractId: string;
  ticker: string;
  contract: {
    symbol: string;
    optionType: 'CALL' | 'PUT';
    strike: number;
    expiration: string;
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    impliedVolatility?: number;
    openInterest?: number;
    volume?: number;
    bid?: number;
    ask?: number;
    lastPrice?: number | null;
    currentStockPrice?: number;
  };
}

export interface ContractScoreFactors {
  news_sentiment?: number;
  sector_performance?: number;
  market_conditions?: number;
  greeks_score?: number;
  expiry_timing?: number;
}

export interface ContractScore {
  id: string;
  user_id: string;
  tracked_contract_id: string;
  ticker: string;
  contract_symbol: string;
  score: number;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  reasoning: string;
  factors?: ContractScoreFactors;
  created_at: string;
}
