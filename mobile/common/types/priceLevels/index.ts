import type { OptionsContract } from '@/common/types/blogPosts/ticker';

// 'either' only ever applies while status === 'watching' — a level watching
// both sides of a two-sided setup (see backend key_level_watcher.py). Once
// confirmed, the backend overwrites this with whichever side actually
// triggered ('bullish' or 'bearish'), so a confirmed row is never 'either'.
export type LevelDirection = 'bullish' | 'bearish' | 'either';
export type LevelSource = 'self' | 'discord_admin';
export type LevelStatus = 'watching' | 'confirmed' | 'expired' | 'cancelled';

export interface NamedContract {
  option_type: 'CALL' | 'PUT';
  strike: number;
  expiration_date: string;
}

export interface LevelSuggestedContract {
  contract: OptionsContract;
  score: number | null;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | null;
  reasoning: string | null;
  pinned: boolean;
}

export interface WatchedPriceLevel {
  id: string;
  user_id: string;
  ticker: string;
  level_low: number;
  level_high: number;
  direction: LevelDirection;
  source: LevelSource;
  notes: string | null;
  named_contracts: NamedContract[];
  status: LevelStatus;
  confirmed_at: string | null;
  confirmed_price: number | null;
  suggested_contracts: LevelSuggestedContract[] | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePriceLevelRequest {
  userId: string;
  ticker: string;
  direction: LevelDirection;
  levelLow: number;
  levelHigh?: number;
  source?: LevelSource;
  notes?: string;
  namedContracts?: NamedContract[];
}
