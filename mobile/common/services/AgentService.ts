// Expo's fetch (unlike RN's global fetch) exposes a real ReadableStream on
// `response.body`, which is required for the SSE token streaming below.
import { fetch } from 'expo/fetch';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type {
  AgentChatRequest,
  AgentChatResponse,
  AgentStreamChunk,
  ContractScoreRequest,
  ContractScore,
  ParseScreenshotRequest,
  ParseScreenshotResponse,
} from '@/common/types/agent';

const AGENT_SYSTEM_PROMPT = `You are TINDEX, an expert AI financial assistant specializing in options trading and market analysis. You provide data-driven, actionable insights about options contracts, market trends, and trading strategies.

Guidelines:
- Always analyze the Greeks (delta, gamma, theta, vega) when relevant to the discussion
- Consider implied volatility (IV) relative to historical levels when evaluating contracts
- Factor in recent news, sector performance, and broader market conditions
- Provide balanced perspectives — include both bullish and bearish scenarios
- Include risk management considerations in your analysis
- Search for the latest news and market data to ensure up-to-date information
- Use bullet points for key insights and keep responses scannable
- Include a brief disclaimer: "Not financial advice. Always do your own research."

When analyzing a specific ticker, cover:
1. Current market context and sentiment
2. Key options metrics and positioning
3. Notable upcoming catalysts (earnings, FDA, macro events)
4. Sector and index correlation
5. Risk/reward assessment for the trade`;

// Map raw API/network errors to user-facing messages.
function toFriendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  // Claude quota / billing
  if (lower.includes('insufficient_credits') || lower.includes('credit') || lower.includes('402'))
    return 'AI is currently unavailable — credits exhausted. Please try again later.';
  // Rate limit
  if (lower.includes('rate_limit') || lower.includes('429') || lower.includes('too many requests'))
    return 'Too many requests. Please wait a moment and try again.';
  // Claude overloaded
  if (lower.includes('overloaded') || lower.includes('529'))
    return 'The AI service is overloaded. Please try again in a few seconds.';
  // Authentication / API key
  if (lower.includes('401') || lower.includes('api_key') || lower.includes('unauthorized'))
    return 'AI service configuration error. Please contact support.';
  // Generic server error
  if (lower.includes('500') || lower.includes('502') || lower.includes('503'))
    return 'AI service is temporarily unavailable. Please try again later.';
  // Network
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('econnrefused'))
    return 'Unable to reach the AI service. Check your connection and try again.';

  return 'AI is unavailable right now. Please try again later.';
}

export async function streamAgentChat(
  request: AgentChatRequest,
  onChunk: (chunk: string) => void,
  onComplete: (response: AgentChatResponse) => void,
  onError: (error: string) => void,
): Promise<void> {
  try {
    const response = await fetch(`${RAILWAY_BASE_URL}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: request.userId,
        message: request.message,
        conversation_id: request.conversationId,
        ticker: request.ticker,
        contract_context: request.contractContext,
        system_prompt: AGENT_SYSTEM_PROMPT,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || (err as any).type || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body available');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResponse: AgentChatResponse | null = null;
    let accumulatedContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        let data: AgentStreamChunk;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue; // skip malformed SSE lines
        }

        if (data.type === 'chunk' && data.content) {
          accumulatedContent += data.content;
          onChunk(data.content);
        } else if (data.type === 'complete') {
          finalResponse = {
            conversationId: data.conversationId ?? '',
            messageId: data.messageId ?? '',
            response: data.content ?? accumulatedContent,
            title: data.title,
          };
        } else if (data.type === 'error') {
          // Backend forwarded a Claude/service error — map to friendly message
          throw new Error(data.error ?? 'Agent error');
        }
      }
    }

    if (finalResponse) {
      onComplete(finalResponse);
    } else if (accumulatedContent) {
      onComplete({
        conversationId: '',
        messageId: '',
        response: accumulatedContent,
      });
    }
  } catch (error) {
    onError(toFriendlyError(error));
  }
}

export async function parseFlowScreenshot(request: ParseScreenshotRequest): Promise<ParseScreenshotResponse> {
  try {
    const response = await fetch(`${RAILWAY_BASE_URL}/api/agent/parse-screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: request.userId,
        conversation_id: request.conversationId,
        message: request.message,
        image_base64: request.imageBase64,
        media_type: request.mediaType,
        previous_checklist: request.previousChecklist,
        system_prompt: AGENT_SYSTEM_PROMPT,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Failed to parse screenshot');
    return data.data as ParseScreenshotResponse;
  } catch (error) {
    throw new Error(toFriendlyError(error));
  }
}

export async function scoreContract(request: ContractScoreRequest): Promise<ContractScore> {
  const response = await fetch(`${RAILWAY_BASE_URL}/api/agent/score_contract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: request.userId,
      tracked_contract_id: request.trackedContractId,
      ticker: request.ticker,
      contract: request.contract,
      system_prompt: AGENT_SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Scoring failed');
  return data.data as ContractScore;
}
