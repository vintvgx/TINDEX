
export interface TopicDetails {
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
  topic: TopicDetails;
  topicIdentification: string;
}

export interface User {
  id: number;
  created_at: string;
  updated_at: string;
  email: string;
  phone: string;
}

//TODO: Deprecated ?
export enum PROMPT_STYLES {
  basic = "BASIC_PROMPT",
  inter = "INTERMEDIATE_PROMPT"
}
