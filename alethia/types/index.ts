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
    seo_data?: any;
    multimedia_data?: any;
    research_data?: any;
    created_at: string;
    published_at?: string;
    user_id: string;
    topics?: Topic;
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
  }