export const API_ENDPOINTS = {
  GENERATE_BLOG_POST: '/functions/v1/generate-blog-post',
  GET_JOB_STATUS: '/functions/v1/get-job-status',
  SCHEDULED_GENERATION: '/functions/v1/scheduled-generation',
} as const;

export const DATABASE_TABLES = {
  TOPICS: 'topics',
  BLOG_POSTS: 'blog_posts',
  GENERATION_JOBS: 'generation_jobs',
  USER_PREFERENCES: 'user_preferences',
} as const;

export const JOB_STATUSES = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const BLOG_POST_STATUSES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  FAILED: 'failed',
} as const;

export const CONTENT_LENGTHS = {
  SHORT: 400,
  MEDIUM: 800,
  LONG: 1200,
} as const;

export const GENERATION_STEPS = {
  INITIALIZING: 'initializing',
  RESEARCH: 'research',
  GENERATION: 'generation',
  ENHANCEMENT: 'enhancement',
  COMPLETED: 'completed',
} as const;

export const CATEGORIES = [
  'Technology',
  'Science',
  'Business',
  'Health',
  'Environment',
  'Politics',
  'Sports',
  'Entertainment',
  'Education',
  'Travel',
] as const;
