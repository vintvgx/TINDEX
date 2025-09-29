import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { BlogPostType } from '@/common/types';

interface PostModalContextType {
  expandedPost: BlogPostType | null;
  isAnimating: boolean;
  expandPost: (post: BlogPostType) => void;
  collapsePost: () => void;
  setAnimating: (animating: boolean) => void;
}

const PostModalContext = createContext<PostModalContextType | undefined>(undefined);

interface PostModalProviderProps {
  children: ReactNode;
}

export const PostModalProvider: React.FC<PostModalProviderProps> = ({ children }) => {
  const [expandedPost, setExpandedPost] = useState<BlogPostType | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const expandPost = useCallback((post: BlogPostType) => {
    setExpandedPost(post);
  }, []);

  const collapsePost = useCallback(() => {
    setExpandedPost(null);
  }, []);

  const setAnimating = useCallback((animating: boolean) => {
    setIsAnimating(animating);
  }, []);

  const value: PostModalContextType = {
    expandedPost,
    isAnimating,
    expandPost,
    collapsePost,
    setAnimating,
  };

  return (
    <PostModalContext.Provider value={value}>
      {children}
    </PostModalContext.Provider>
  );
};

export const usePostModal = (): PostModalContextType => {
  const context = useContext(PostModalContext);
  if (context === undefined) {
    throw new Error('usePostModal must be used within a PostModalProvider');
  }
  return context;
}; 