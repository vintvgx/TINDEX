import { User } from "@supabase/supabase-js";

export interface DeleteBlogPostRequest {
    id: string;
    user: User | null;
  }
  
  export interface DeleteBlogPostResponse {
    success: boolean;
    data: string | any;
  }