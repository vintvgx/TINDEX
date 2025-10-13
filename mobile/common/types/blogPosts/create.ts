import { TopicType } from "..";

/**
 * Interface for fetching or creating the topic return
 */
export interface GetOrCreateTopicResponse {
  topic: TopicType;
  success: boolean;
  message: string;
  isNewTopic: boolean;
}

/**
 * Interface for the blog post generation request
 */
export interface GenerateBlogPostRequest {
  userId: string;
  //TODO update code to use content instead of topicName
  // content: string;
  ticker: string;
  categoryName: string;
  targetLength: number;
  priority?: PRIORITY_TYPE;
}

export enum SortBy {
  VOLUME = "volume",
  CHANGE = "change",
  PE = "pe", 
  MARKET_CAP = "marketcap"
}

export enum PRIORITY_TYPE {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  DEBUG = "debug",
}

/**
 * Interface for the blog post generation response
 */
export interface GenerateBlogPostResponse {
  success: boolean;
  jobId: string;
  blogPostId: string;
  message: string;
  blogPostData: {
    topic: TopicType;
    user_id: string;
    title: string;
    content: string;
    word_count: number;
    reading_time: number;
    status: string;
    generation_job_id: string;
    research_data: any;
    published_at: string;
  };
}

/**
 * Error types for topic creation and blog generation
 */
export type BlogException =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NETWORK_ERROR"
  | "DATABASE_ERROR"
  | "GENERATION_FAILED"
  | "UNKNOWN_ERROR";
