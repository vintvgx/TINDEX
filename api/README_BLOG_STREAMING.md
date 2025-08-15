# Blog Post Streaming API

This document describes the new streaming blog post generation functionality that allows real-time content generation with ticker information support.

## Overview

The blog streaming API provides two main endpoints:
1. **Streaming endpoint** (`/generate_blog_post_stream`) - Real-time content generation
2. **Non-streaming endpoint** (`/generate_blog_post`) - Single response generation

Both endpoints support ticker information integration for enhanced financial analysis.

## Features

- ✅ **Real-time streaming** - Content appears as it's generated
- ✅ **Ticker integration** - Enhanced financial analysis with stock symbols
- ✅ **Research data support** - Incorporate market data and financial metrics
- ✅ **Error handling** - Comprehensive error management and recovery
- ✅ **Type safety** - Full TypeScript support with proper interfaces
- ✅ **Async/await support** - Modern JavaScript/TypeScript patterns

## API Endpoints

### 1. Streaming Blog Post Generation

**Endpoint:** `POST /generate_blog_post_stream`

**Description:** Generates blog content in real-time using Server-Sent Events (SSE).

**Request Body:**
```json
{
  "topic": "Apple Inc.",
  "research_data": {
    "market_cap": 3000000000000,
    "current_price": 150.50,
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "pe_ratio": 25.5,
    "dividend_yield": 0.5,
    "beta": 1.2
  },
  "target_length": 800,
  "ticker": "AAPL"
}
```

**Response:** Server-Sent Events stream with JSON chunks:
```
data: {"chunk": "Apple Inc. (AAPL) has demonstrated", "success": true}

data: {"chunk": " remarkable resilience in the technology sector", "success": true}

data: {"complete": true, "success": true}
```

### 2. Non-Streaming Blog Post Generation

**Endpoint:** `POST /generate_blog_post`

**Description:** Generates complete blog post in a single response.

**Request Body:** Same as streaming endpoint

**Response:**
```json
{
  "success": true,
  "title": "Comprehensive Analysis: Apple Inc. (AAPL) - A Technology Titan",
  "content": "Apple Inc. (AAPL) has demonstrated remarkable resilience...",
  "word_count": 750,
  "reading_time": 4,
  "ticker": "AAPL",
  "research_data": {...}
}
```

### 3. Connection Test

**Endpoint:** `GET /test_anthropic`

**Description:** Tests the Anthropic API connection.

**Response:**
```json
{
  "success": true,
  "message": "Anthropic API connection successful",
  "response": "Hello! I'm here to help you with any questions or tasks you might have."
}
```

## Frontend Integration

### React Hook Usage

```typescript
import { useBlogStreaming } from '../utils/blogStreaming';

const MyComponent = () => {
  const { isStreaming, content, error, isComplete, startStreaming, reset } = useBlogStreaming();

  const handleGenerate = async () => {
    await startStreaming({
      topic: 'Tesla Inc.',
      researchData: {
        market_cap: 800000000000,
        current_price: 250.00,
        sector: 'Automotive',
      },
      targetLength: 800,
      ticker: 'TSLA',
    });
  };

  return (
    <div>
      <button onClick={handleGenerate} disabled={isStreaming}>
        {isStreaming ? 'Generating...' : 'Generate Blog Post'}
      </button>
      
      {content && (
        <div>
          <pre>{content}</pre>
          {isStreaming && <span>|</span>}
        </div>
      )}
      
      {error && <div>Error: {error}</div>}
      {isComplete && <div>✅ Complete!</div>}
    </div>
  );
};
```

### Direct API Usage

```typescript
import { streamBlogPost, generateBlogPost } from '../utils/blogStreaming';

// Streaming usage
const handleStreaming = async () => {
  try {
    await streamBlogPost({
      topic: 'Microsoft Corporation',
      researchData: {
        market_cap: 2500000000000,
        current_price: 350.00,
        sector: 'Technology',
      },
      targetLength: 800,
      ticker: 'MSFT',
      onChunk: (chunk) => {
        console.log('Received chunk:', chunk);
        // Update UI with new content
      },
      onComplete: (fullContent) => {
        console.log('Generation complete:', fullContent);
        // Handle completion
      },
      onError: (error) => {
        console.error('Generation error:', error);
        // Handle error
      },
    });
  } catch (error) {
    console.error('Streaming failed:', error);
  }
};

// Non-streaming usage
const handleNonStreaming = async () => {
  try {
    const result = await generateBlogPost({
      topic: 'Amazon.com Inc.',
      researchData: {
        market_cap: 1800000000000,
        current_price: 180.00,
        sector: 'Consumer Discretionary',
      },
      targetLength: 800,
      ticker: 'AMZN',
    });

    if (result.success) {
      console.log('Generated blog post:', result);
    } else {
      console.error('Generation failed:', result.error);
    }
  } catch (error) {
    console.error('API call failed:', error);
  }
};
```

## Setup and Configuration

### 1. Environment Variables

Ensure these environment variables are set:

```bash
ANTHROPIC_API_KEY=your_anthropic_api_key_here
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 2. Dependencies

Install required packages:

```bash
pip install anthropic flask asyncio
```

### 3. Service Initialization

The services are automatically initialized when imported:

```python
from services.anthropic_service import anthropic_service
from services.supabase_service import supabase_service
```

## Error Handling

### Common Error Scenarios

1. **Missing API Key**
   ```
   Error: ANTHROPIC_API_KEY not defined
   Solution: Set the environment variable
   ```

2. **Invalid Topic**
   ```
   Error: Topic must be a non-empty string
   Solution: Provide a valid topic
   ```

3. **Network Issues**
   ```
   Error: HTTP error! status: 500
   Solution: Check API connectivity and retry
   ```

### Error Response Format

```json
{
  "success": false,
  "error": "Detailed error message",
  "operation": "operation_that_failed",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## Best Practices

### 1. Research Data Structure

Provide comprehensive research data for better content quality:

```json
{
  "market_cap": 1000000000,
  "current_price": 150.50,
  "price_change": 2.50,
  "price_change_percent": 1.67,
  "volume": 50000000,
  "pe_ratio": 25.5,
  "dividend_yield": 0.5,
  "beta": 1.2,
  "sector": "Technology",
  "industry": "Software",
  "sentiment": {
    "sentiment": "positive",
    "confidence": 0.85
  }
}
```

### 2. Ticker Usage

- Use standard ticker symbols (e.g., "AAPL", "TSLA", "MSFT")
- Ticker is optional but enhances financial analysis
- Automatically converts to uppercase

### 3. Content Length

- Default target length: 800 words
- Recommended range: 500-1500 words
- Longer content takes more time to generate

### 4. Streaming Best Practices

- Always handle the `onError` callback
- Provide visual feedback during streaming
- Allow users to cancel long-running operations
- Cache completed content for offline access

## Performance Considerations

### 1. Response Times

- **Streaming:** Content appears in real-time (typically 50-200ms per chunk)
- **Non-streaming:** Complete response in 5-30 seconds depending on length

### 2. Rate Limiting

- Anthropic API has rate limits
- Implement exponential backoff for retries
- Monitor API usage and costs

### 3. Caching

- Cache generated content to avoid regeneration
- Store research data for reuse
- Implement content versioning

## Security Considerations

### 1. API Key Management

- Never expose API keys in client-side code
- Use environment variables for sensitive data
- Rotate keys regularly

### 2. Input Validation

- Validate all user inputs
- Sanitize topic and ticker symbols
- Limit research data size

### 3. Error Information

- Don't expose internal error details
- Log errors server-side for debugging
- Provide user-friendly error messages

## Troubleshooting

### 1. Streaming Issues

**Problem:** Content not appearing in real-time
**Solution:** Check browser compatibility with Server-Sent Events

**Problem:** Connection drops during streaming
**Solution:** Implement automatic reconnection logic

### 2. Content Quality Issues

**Problem:** Generated content is generic
**Solution:** Provide more detailed research data

**Problem:** Content doesn't match ticker
**Solution:** Ensure ticker symbol is correct and research data is relevant

### 3. Performance Issues

**Problem:** Slow generation times
**Solution:** Reduce target length or optimize research data

**Problem:** High API costs
**Solution:** Implement caching and rate limiting

## Examples

### Complete React Component

See `mobile/components/BlogStreamingComponent.tsx` for a complete example.

### API Testing

```bash
# Test connection
curl -X GET http://localhost:5000/test_anthropic

# Test streaming
curl -X POST http://localhost:5000/generate_blog_post_stream \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Apple Inc.",
    "research_data": {
      "market_cap": 3000000000000,
      "current_price": 150.50,
      "sector": "Technology"
    },
    "ticker": "AAPL"
  }'

# Test non-streaming
curl -X POST http://localhost:5000/generate_blog_post \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Tesla Inc.",
    "research_data": {
      "market_cap": 800000000000,
      "current_price": 250.00,
      "sector": "Automotive"
    },
    "ticker": "TSLA"
  }'
```

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review error logs
3. Test with the connection endpoint
4. Verify environment variables
5. Check API rate limits and quotas 