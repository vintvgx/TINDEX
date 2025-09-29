import { BlogPostType } from "..";

// Navigation types
export type RootStackParamList = {
    Auth: undefined;
    Main: undefined;
  };
  
  export type AuthStackParamList = {
    Login: undefined;
    Signup: undefined;
  };
  
  export type MainTabParamList = {
    Home: undefined;
    BlogList: undefined;
    Topics: undefined;
    Settings: undefined;
  };
  
  export type MainStackParamList = {
    MainTabs: undefined;
    BlogDetail: { blogPost: BlogPostType };
    Generate: { topicId?: string };
  };