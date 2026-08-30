export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  /** Set only on a checklist message — see supabase/migrations/20260824_ai_messages_metadata.sql.
   *  Lets AgentModal reconstruct the same interactive ChecklistCard (not just
   *  its text summary) after the conversation reloads. */
  metadata?: {
    checklist?: FlowChecklist;
    checklist_status?: 'pending' | 'submitted' | 'skipped';
  } | null;
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

// ─── Flow-screenshot checklist ─────────────────────────────────────────────

export interface FlowChecklistContract {
  option_type: 'CALL' | 'PUT';
  strike: number;
  expiration_date: string;
  note: string;
  /** True when this exact contract is already in tracked_options_contracts
   *  (status='tracking') for the user — set server-side at parse time so a
   *  re-parsed/resent alert doesn't offer to track a duplicate. */
  already_tracked?: boolean;
  /** Contract PREMIUM (not underlying stock price) the alert stated for
   *  entry/stop-loss, when present — used to set an alert-matched stop at
   *  trade entry (see TradeContractSheet's alertEntryPrice/alertStopLoss
   *  props): the differential (entry_price - stop_loss) is preserved and
   *  reapplied against whatever price the contract is actually entered at,
   *  since that's rarely the exact alert price by the time it's acted on. */
  entry_price?: number | null;
  stop_loss?: number | null;
}

export interface FlowWatchZone {
  low: number;
  high: number;
  /** True when an active watched_price_levels row already overlaps this
   *  zone for the user — set server-side at parse time, same rationale as
   *  FlowChecklistContract.already_tracked. */
  already_tracked?: boolean;
}

export interface FlowChecklist {
  ticker: string | null;
  sentiment: 'bullish' | 'bearish' | 'either' | null;
  watch_zone: FlowWatchZone | null;
  contracts: FlowChecklistContract[];
  summary: string;
  reply: string;
}

export interface ParseScreenshotRequest {
  userId: string;
  conversationId?: string;
  message?: string;
  imageBase64?: string;
  mediaType?: string;
  previousChecklist?: FlowChecklist;
}

export interface ParseScreenshotResponse {
  conversationId: string;
  messageId: string;
  /** Id of the SEPARATE ai_messages row carrying the checklist itself
   *  (metadata.checklist) — pass this to useUpdateChecklistStatus on
   *  Submit/Skip so the resolution persists and survives a reload. */
  checklistMessageId: string;
  checklist: FlowChecklist;
  title?: string;
}

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
