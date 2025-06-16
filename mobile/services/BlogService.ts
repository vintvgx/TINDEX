import { supabase } from './supabase';
import { BlogPost, Topic, GenerationJob } from '@/types';

export class BlogService {
  static async generateBlogPost(topicId: string, targetLength = 800) {
    const { data, error } = await supabase.functions.invoke('generate-blog-post', {
      body: {
        topicId,
        targetLength,
      },
    });

    if (error) throw error;
    return data;
  }

  static async getJobStatus(jobId: string): Promise<GenerationJob> {
    const { data, error } = await supabase.functions.invoke('get-job-status', {
      body: { jobId },
    });

    if (error) throw error;
    return data;
  }

  static async getBlogPosts(limit = 10, offset = 0): Promise<BlogPost[]> {
    const { data, error } = await supabase
      .from('blog_posts')
      .select(`
        *,
        topics(*)
      `)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  static async getBlogPost(id: string): Promise<BlogPost> {
    const { data, error } = await supabase
      .from('blog_posts')
      .select(`
        *,
        topics(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  static async getTopics(): Promise<Topic[]> {
    const { data, error } = await supabase
      .from('topics')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  }

  static subscribeToJobUpdates(jobId: string, callback: (payload: any) => void) {
    return supabase
      .channel('job_updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'generation_jobs',
        filter: `id=eq.${jobId}`,
      }, callback)
      .subscribe();
  }

  static subscribeToNewPosts(callback: (payload: any) => void) {
    return supabase
      .channel('new_posts')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'blog_posts',
      }, callback)
      .subscribe();
  }
}