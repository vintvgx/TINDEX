# API Architecture Documentation

## Overview

This document describes the optimal architecture for the Alethia API, which separates concerns between research data acquisition and blog post generation using a **Service Layer Pattern**.

## Architecture Pattern: Service Layer

### Why Service Layer?

The service layer pattern provides several key benefits:

1. **Separation of Concerns**: Endpoints handle HTTP concerns, services handle business logic
2. **Reusability**: Service methods can be used by multiple endpoints
3. **Testability**: Services can be tested independently without HTTP mocking
4. **Maintainability**: Changes to business logic don't affect endpoint structure
5. **No HTTP Overhead**: Internal service calls don't incur HTTP request overhead

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    API Endpoints (app.py)                    │
│  Responsibilities:                                           │
│  - HTTP request/response handling                            │
│  - Request validation                                        │
│  - Authentication/Authorization                              │
│  - Response formatting                                       │
│  - Error handling (HTTP errors)                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      Service Layer                           │
│  Responsibilities:                                           │
│  - Business logic orchestration                              │
│  - Data validation and transformation                        │
│  - Caching logic                                             │
│  - Transaction management                                    │
│  - Error handling (business errors)                          │
│                                                               │
│  Services:                                                   │
│  ├── StockResearchService (research_service.py)             │
│  │   - Orchestrates research data acquisition                │
│  │   - Manages research caching                              │
│  │   - Handles research persistence                          │
│  │                                                            │
│  └── BlogGenerationService (blog_generation_service.py)     │
│      - Orchestrates blog content generation                  │
│      - Integrates research with AI                           │
│      - Handles blog post persistence                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Data Access Layer                           │
│  Responsibilities:                                           │
│  - Database operations                                       │
│  - External API calls                                        │
│  - Data mapping                                              │
│  - Connection management                                     │
│                                                               │
│  Services:                                                   │
│  ├── SupabaseService (supabase_service.py)                  │
│  │   - Database CRUD operations                              │
│  │   - Cache management                                      │
│  │   - User verification                                     │
│  │                                                            │
│  ├── YFinanceService (yfinance_service.py)                  │
│  │   - Stock data fetching                                   │
│  │   - Financial metrics calculation                         │
│  │   - Sentiment analysis                                    │
│  │                                                            │
│  └── AnthropicService (anthropic_service.py)                │
│      - AI content generation                                 │
│      - Streaming support                                     │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Why NOT Call API Endpoints from Services?

**WRONG Approach** ❌:
```python
# BAD: Calling API endpoint from service
def generate_blog(ticker):
    # Making HTTP request to our own API
    response = requests.post('http://localhost:5000/research_yfinance', 
                            json={'topic': ticker})
    research_data = response.json()
    # ... generate blog
```

**Problems with this approach**:
- **HTTP Overhead**: Adds latency (network stack, serialization, etc.)
- **Tight Coupling**: Services depend on API structure
- **Testing Complexity**: Must mock HTTP requests
- **Error Handling**: Mix HTTP errors with business errors
- **Transaction Management**: Can't wrap operations in single transaction
- **Authentication**: Must handle auth tokens internally
- **Resource Waste**: Unnecessary serialization/deserialization

**CORRECT Approach** ✅:
```python
# GOOD: Calling service method directly
def generate_blog(ticker, research_service):
    # Direct method call - fast and clean
    research_result = research_service.get_research_data(ticker=ticker)
    research_data = research_result['data']
    # ... generate blog
```

**Benefits of this approach**:
- **Performance**: Direct function calls are orders of magnitude faster
- **Loose Coupling**: Services depend on interfaces, not HTTP contracts
- **Testability**: Easy to mock service dependencies
- **Clean Errors**: Business logic errors only
- **Transactions**: Can wrap multiple operations atomically
- **Simplicity**: No auth/serialization overhead

### 2. Service Initialization Pattern

We use **Lazy Loading** with factory functions to avoid circular imports:

```python
# Global instance (initially None)
stock_research_service = None

def get_research_service():
    """Factory function with lazy loading"""
    global stock_research_service
    if stock_research_service is None:
        from services.supabase_service import supabase_service
        stock_research_service = StockResearchService(supabase_service)
    return stock_research_service
```

**Why this pattern?**
- Avoids circular import issues
- Delays initialization until needed
- Centralizes service configuration
- Enables easy testing with mocks

### 3. Dependency Injection

Services accept dependencies through constructor:

```python
class StockResearchService:
    def __init__(self, supabase_service=None):
        self.supabase_service = supabase_service
```

**Benefits**:
- **Testability**: Can inject mock services
- **Flexibility**: Can swap implementations
- **Explicit Dependencies**: Clear what each service needs

## API Endpoints

### 1. `/research_yfinance` - Research Only

**Purpose**: Fetch and cache stock research data (NO blog generation)

**Flow**:
```
Client Request
    ↓
Endpoint validates request
    ↓
StockResearchService.get_research_data()
    ├── Check cache
    ├── Fetch from yFinance (if needed)
    ├── Save to database (if requested)
    └── Cache result
    ↓
Return research data only
```

**Request**:
```json
{
  "userId": "user123",
  "topic": "AAPL",
  "use_cache": true,
  "save_to_db": true
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "ticker": "AAPL",
    "company_name": "Apple Inc.",
    "current_price": 175.50,
    "price_change_percent": 1.27,
    ...
  },
  "research_id": "uuid-abc123",
  "cached": false,
  "timestamp": 1234567890
}
```

### 2. `/generate_post` - Blog Generation

**Purpose**: Generate blog post using research data

**Flow**:
```
Client Request
    ↓
Endpoint validates request
    ↓
StockResearchService.get_research_data()
    ├── Use provided research data OR
    ├── Check cache OR
    └── Fetch fresh data
    ↓
BlogGenerationService.generate_blog_post()
    ├── Generate content with AI
    ├── Associate with research
    └── Save to database (if requested)
    ↓
Return blog post
```

**Request Options**:

Option 1: Use cached/fresh research
```json
{
  "userId": "user123",
  "topic": "AAPL",
  "use_cache": true,
  "save_to_db": true,
  "target_length": 800
}
```

Option 2: Provide research data
```json
{
  "userId": "user123",
  "topic": "AAPL",
  "research_data": {...},
  "save_to_db": true,
  "target_length": 800
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "title": "Apple Inc.: Market Analysis",
    "content": "...",
    "ticker": "AAPL",
    "stock_research_id": "uuid-abc123"
  },
  "blog_id": "uuid-def456",
  "research_id": "uuid-abc123",
  "research_cached": false,
  "blog_saved": true,
  "timestamp": 1234567890
}
```

## Usage Patterns

### Pattern 1: Research Then Generate (Two-Step)

```python
# Step 1: Fetch research data
research_response = requests.post('/research_yfinance', json={
    'userId': 'user123',
    'topic': 'AAPL',
    'save_to_db': True
})
research_data = research_response.json()['data']
research_id = research_response.json()['research_id']

# Step 2: Generate blog using research
blog_response = requests.post('/generate_post', json={
    'userId': 'user123',
    'topic': 'AAPL',
    'research_data': research_data,  # Use fetched data
    'save_to_db': True
})
```

**Use Case**: When you need research data for other purposes (display, analysis)

### Pattern 2: Generate with Automatic Research (One-Step)

```python
# Single call - research happens automatically
blog_response = requests.post('/generate_post', json={
    'userId': 'user123',
    'topic': 'AAPL',
    'use_cache': True,  # Will use cached research if available
    'save_to_db': True
})
```

**Use Case**: Quick blog generation without needing separate research data

### Pattern 3: Batch Research, Generate Later

```python
# Research multiple tickers upfront
tickers = ['AAPL', 'GOOGL', 'MSFT']
for ticker in tickers:
    requests.post('/research_yfinance', json={
        'userId': 'user123',
        'topic': ticker,
        'save_to_db': True
    })

# Generate blogs later using cached research
for ticker in tickers:
    requests.post('/generate_post', json={
        'userId': 'user123',
        'topic': ticker,
        'use_cache': True  # Uses previously cached data
    })
```

**Use Case**: Scheduled blog generation or batch processing

## Error Handling

### Service Layer Errors

Services return structured error responses:

```python
{
    "success": False,
    "error": "Detailed error message",
    "cached": False
}
```

### Endpoint Error Responses

Endpoints convert service errors to HTTP errors:

```python
if not result["success"]:
    return jsonify(result), 400  # Bad Request

# Or for server errors
return jsonify({"success": False, "error": str(e)}), 500
```

## Testing Strategy

### Unit Testing Services

```python
def test_research_service():
    # Mock dependencies
    mock_supabase = Mock()
    research_service = StockResearchService(mock_supabase)
    
    # Test business logic
    result = research_service.get_research_data('AAPL')
    assert result['success'] == True
```

### Integration Testing Endpoints

```python
def test_generate_post_endpoint():
    response = client.post('/generate_post', json={
        'userId': 'test-user',
        'topic': 'AAPL'
    })
    assert response.status_code == 200
    assert response.json['success'] == True
```

## Performance Considerations

1. **Caching Strategy**:
   - Research data cached for reuse
   - Cache TTL configurable
   - Cache invalidation on market close/open

2. **Async Operations**:
   - AI generation uses async/await
   - Sync endpoints wrap async operations properly

3. **Database Connections**:
   - Connection pooling in Supabase service
   - Automatic retry logic

## Security Best Practices

1. **Input Validation**:
   - Ticker symbol format validation
   - User ID verification
   - Request data sanitization

2. **Error Messages**:
   - Don't expose internal details
   - Log detailed errors server-side
   - Return generic errors to client

3. **Rate Limiting** (TODO):
   - Per-user request limits
   - Per-endpoint limits
   - Cache to reduce API calls

## Migration Path

If you have existing code calling endpoints internally:

### Before (Anti-pattern):
```python
def some_function():
    # Calling own API endpoint
    response = requests.post('http://localhost/research', ...)
    data = response.json()
```

### After (Best practice):
```python
def some_function():
    # Direct service call
    from services.research_service import get_research_service
    research_service = get_research_service()
    result = research_service.get_research_data(...)
    data = result['data']
```

## Summary

✅ **DO**:
- Use service layer for business logic
- Call services directly from endpoints
- Use dependency injection
- Return structured responses
- Separate concerns (research vs generation)

❌ **DON'T**:
- Call API endpoints from services
- Mix business logic with HTTP logic
- Duplicate code across endpoints
- Couple services to HTTP layer
- Generate blogs in research endpoint

This architecture provides:
- **Performance**: No HTTP overhead for internal calls
- **Maintainability**: Clear separation of concerns
- **Testability**: Easy to unit test each layer
- **Scalability**: Can extract services to microservices later
- **Flexibility**: Easy to add new features or endpoints
