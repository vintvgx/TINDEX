import React, { useState, useCallback } from 'react';
import { streamBlogPost, BlogStreamingOptions } from '../utils/blogStreaming';

interface BlogStreamingComponentProps {
  onComplete?: (content: string) => void;
  onError?: (error: string) => void;
}

export const BlogStreamingComponent: React.FC<BlogStreamingComponentProps> = ({
  onComplete,
  onError,
}) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [topic, setTopic] = useState('');
  const [ticker, setTicker] = useState('');

  const startStreaming = useCallback(async () => {
    if (!topic.trim()) return;

    setIsStreaming(true);
    setContent('');
    setError(null);
    setIsComplete(false);

    try {
      await streamBlogPost({
        topic: topic.trim(),
        researchData: {
          // Example research data - replace with actual data
          market_cap: 1000000000,
          current_price: 150.50,
          sector: 'Technology',
          industry: 'Software',
          pe_ratio: 25.5,
          dividend_yield: 0.5,
          beta: 1.2,
        },
        targetLength: 800,
        ticker: ticker.trim() || undefined,
        onChunk: (chunk) => {
          setContent(prev => prev + chunk);
        },
        onComplete: (fullContent) => {
          setContent(fullContent);
          setIsComplete(true);
          onComplete?.(fullContent);
        },
        onError: (errorMessage) => {
          setError(errorMessage);
          onError?.(errorMessage);
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsStreaming(false);
    }
  }, [topic, ticker, onComplete, onError]);

  const reset = useCallback(() => {
    setIsStreaming(false);
    setContent('');
    setError(null);
    setIsComplete(false);
    setTopic('');
    setTicker('');
  }, []);

  return (
    <div className="blog-streaming-container">
      <div className="input-section">
        <div className="input-group">
          <label htmlFor="topic">Topic:</label>
          <input
            id="topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter topic (e.g., Apple Inc., Tesla, etc.)"
            disabled={isStreaming}
            className="topic-input"
          />
        </div>

        <div className="input-group">
          <label htmlFor="ticker">Ticker Symbol (Optional):</label>
          <input
            id="ticker"
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g., AAPL, TSLA"
            disabled={isStreaming}
            className="ticker-input"
          />
        </div>

        <div className="button-group">
          <button
            onClick={startStreaming}
            disabled={isStreaming || !topic.trim()}
            className="generate-button"
          >
            {isStreaming ? 'Generating...' : 'Generate Blog Post'}
          </button>
          
          <button
            onClick={reset}
            disabled={isStreaming}
            className="reset-button"
          >
            Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {content && (
        <div className="content-section">
          <h3>Generated Content:</h3>
          <div className="content-display">
            <pre className="content-text">
              {content}
              {isStreaming && (
                <span className="cursor-blink">|</span>
              )}
            </pre>
          </div>
          {isComplete && (
            <div className="completion-message">
              ✅ Generation complete!
            </div>
          )}
        </div>
      )}

      {/* Note: This component uses inline styles for React Native compatibility */}
      {/* For web usage, you can replace with CSS classes or styled-components */}
    </div>
  );
};

export default BlogStreamingComponent; 