export interface ApiKeys {
  NEWS_API_KEY: string,
  SERP_API_KEY: string
}

export interface Topic {
  id: string;
  name: string;
  description?: string;
  category?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  slug?: string;
  created_by?: string;
  post_count: number;
}

export interface TopicReturn {
  topic: Topic;
  topicIdentification: string;
}

export interface User {
  id: number;
  created_at: string;
  updated_at: string;
  email: string;
  phone: string;
}

export enum PriorityLevel {
  DEBUG = "debug",
  LOW = "low",
  NORMAL = "normal",
  HIGH =  "high"
}

export enum PROMPT_STYLES {
  basic = "BASIC_PROMPT",
  inter = "INTERMEDIATE_PROMPT"
}
