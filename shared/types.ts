// Shared types between mobile app and Supabase functions


export interface User {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
}

export interface Topic {
  id: string;
  name: string;
  description: string;
  category: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlogPost {
  id: string;
  topic_id: string;
  title: string;
  content: string;
  meta_description?: string;
  keywords: string[];
  hashtags: string[];
  word_count: number;
  reading_time: number;
  status: 'draft' | 'published' | 'failed';
  generation_job_id?: string;
  seo_data?: SEOData;
  multimedia_data?: MultimediaData;
  research_data?: ResearchData;
  created_at: string;
  published_at?: string;
  user_id: string;
}

export interface GenerationJob {
  id: string;
  topic_id: string;
  user_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  current_step: string;
  error_message?: string;
  result_data?: any;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  preferred_topics: string[];
  content_length_preference: 'short' | 'medium' | 'long';
  generation_frequency: 'daily' | 'weekly' | 'manual';
  notification_enabled: boolean;
  api_usage_limit: number;
  created_at: string;
  updated_at: string;
}

export interface SEOData {
  meta_title: string;
  meta_description: string;
  keywords: string[];
  readability_score: number;
  suggested_url_slug: string;
  content_score: {
    length: string;
    keyword_density: string;
    headings: string;
    multimedia: string;
  };
}

export interface MultimediaData {
  images: ImageData[];
  videos: VideoData[];
  tables: TableData[];
  social?: SocialData;
}

export interface ImageData {
  url: string;
  alt_text: string;
  description: string;
  photographer?: string;
  search_term: string;
}

export interface VideoData {
  title: string;
  url: string;
  thumbnail: string;
  duration: string;
  channel: string;
  description: string;
}

export interface TableData {
  id: string;
  title: string;
  description: string;
  type: string;
  headers: string[];
  rows: string[][];
}

export interface SocialData {
  suggested_posts: SocialPost[];
  hashtag_performance: Record<string, HashtagMetrics>;
  trending_related: string[];
}

export interface SocialPost {
  platform: string;
  text: string;
  hashtags: string[];
}

export interface HashtagMetrics {
  estimated_reach: string;
  engagement_rate: string;
}

export interface ResearchData {
  news_articles: NewsArticle[];
  trending_info: TrendingInfo[];
  statistics: StatisticData[];
  recent_developments: string[];
  key_facts: string[];
}

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  published_at: string;
  source: string;
  content_snippet?: string;
}

export interface TrendingInfo {
  title: string;
  snippet: string;
  link: string;
  position?: number;
}

export interface StatisticData {
  value: string;
  context: string;
  source: string;
}

// Options Tracking Types
export interface TrackedOptionContract {
  id: string;
  user_id: string;
  ticker: string;
  contract_symbol: string;
  option_type: 'CALL' | 'PUT';
  strike: number;
  expiration_date: string;
  tracking_snapshot: any; // OptionsOpportunity object
  status: 'tracking' | 'entered' | 'exited' | 'expired' | 'cancelled';
  entry_price?: number;
  entry_date?: string;
  exit_price?: number;
  exit_date?: string;
  position_size?: number;
  pnl?: number;
  pnl_percentage?: number;
  max_profit?: number;
  max_loss?: number;
  held_duration_days?: number;
  tracked_from_source: 'orb_breakout' | 'manual' | 'followed_stock';
  orb_breakout_id?: string;
  initial_analysis_score?: number;
  tracking_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface TrackOptionRequest {
  userId: string;
  ticker: string;
  contractSymbol: string;
  optionType: 'CALL' | 'PUT';
  strike: number;
  expirationDate: string;
  trackingSnapshot: any; // OptionsOpportunity object
  trackedFromSource?: 'orb_breakout' | 'manual' | 'followed_stock';
  orbBreakoutId?: string;
  initialAnalysisScore?: number;
  trackingReason?: string;
}

export interface UpdateContractStatusRequest {
  userId: string;
  contractId: string;
  status: 'entered' | 'exited' | 'cancelled';
  entryPrice?: number;
  exitPrice?: number;
  positionSize?: number;
}

// API Request/Response types
export interface BlogGenerationRequest {
  topicId: string;
  userId: string;
  targetLength?: number;
  priority?: PRIORITY_TYPE;
}

export interface BlogGenerationResponse {
  success: boolean;
  jobId?: string;
  blogPostId?: string;
  message: string;
  error?: string;
}

export interface JobStatusResponse {
  id: string;
  status: GenerationJob['status'];
  progress: number;
  current_step: string;
  error_message?: string;
  result_data?: any;
}

export enum PRIORITY_TYPE {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  DEBUG = "debug"
}
