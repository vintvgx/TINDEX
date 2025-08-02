# Category-Based Blog Post Architecture

## Overview

This document outlines the architecture for handling category-specific content in blog posts, specifically focusing on the stock information display implementation and the broader category system design.

## Architecture Decision: Single Component with Category-Specific Sections

### Why This Approach?

We chose to implement a **single `BlogPostCard` component with category-specific sections** rather than creating separate components for each category. This decision was based on several key factors:

#### Advantages:

1. **Maintainability**: Single source of truth for card layout and styling
2. **Consistency**: Unified design language across all categories
3. **Performance**: No component switching overhead
4. **Scalability**: Easy to add new categories without creating new components
5. **Code Reuse**: Common functionality shared across all categories
6. **Type Safety**: Centralized type checking and validation
7. **Testing**: Easier to test with a single component

#### Trade-offs Considered:

- **Component Complexity**: Single component becomes larger but is well-organized
- **Bundle Size**: Slightly larger initial bundle but better tree-shaking
- **Development Speed**: Faster to implement new categories

## Implementation Structure

### Core Components

#### 1. `CategorySections.tsx`
- **Purpose**: Centralized category-specific content rendering
- **Props**: `post: BlogPostType`, `variant: 'card' | 'modal'`
- **Responsibility**: Determines which category section to render based on post category

#### 2. `BlogPostCard.tsx`
- **Purpose**: Main card component for blog post previews
- **Integration**: Uses `CategorySections` with `variant="card"`
- **Responsibility**: Handles common card layout, image, title, content preview

#### 3. `PostDetailModal.tsx`
- **Purpose**: Detailed view modal for blog posts
- **Integration**: Uses `CategorySections` with `variant="modal"`
- **Responsibility**: Handles modal layout, full content display

### Category Detection Logic

```typescript
// Check if post has stock research data
const hasStockData = (): boolean => {
  return post.topics?.category === 'stocks' && post.research_data?.alphaVantageData;
};
```

### Stock Information Display

#### Card Variant (Compact)
- Stock symbol and company name
- Current price with change indicator
- Key metrics in a 2x2 grid (Volume, Market Cap, 52W High/Low)
- Sector information

#### Modal Variant (Comprehensive)
- Large stock header with symbol and company name
- Prominent price display with change
- Detailed metrics grid (6 metrics)
- Company overview with description
- Recent news section (up to 3 articles)

## Data Flow

### 1. Research Data Structure
```typescript
interface StockResearchData {
  keyFacts: StockKeyFact[];
  statistics: StockStatistic[];
  serpApiData: SerpApiData;
  newsArticles: NewsArticlesData;
  trendingInfo: TrendingInfo[];
  alphaVantageData: AlphaVantageData;
  recentDevelopments: RecentDevelopment[];
}
```

### 2. Blog Post Integration
```typescript
interface BlogPostType {
  // ... other fields
  research_data?: any; // Contains category-specific research data
  topics?: TopicType;   // Contains category information
}
```

### 3. Category Detection
The system detects the category from `post.topics.category` and checks for corresponding research data in `post.research_data`.

## Extending for New Categories

### Adding a New Category

1. **Update Category Types** (`mobile/types/categories/index.ts`):
```typescript
export interface SportsCategoryType extends BaseCategoryType {
  // Sports-specific data structure
  teamStats: TeamStats;
  playerData: PlayerData;
  gameResults: GameResult[];
}
```

2. **Add Category Renderer** (`mobile/components/CategorySections.tsx`):
```typescript
const renderSportsSection = () => {
  const sportsData = getSportsData();
  if (!sportsData) return null;
  
  return variant === 'card' ? renderSportsCard() : renderSportsModal();
};
```

3. **Update Category Switch**:
```typescript
switch (category) {
  case 'stocks':
    return variant === 'card' ? renderStockCard() : renderStockModal();
  case 'sports':
    return renderSportsSection();
  // ... other cases
}
```

### Category-Specific Considerations

#### Sports Category
- Team statistics and standings
- Player performance data
- Recent game results
- Upcoming matches

#### News Category
- Breaking news indicators
- Source credibility badges
- Related articles
- Timeline of events

#### Science Category
- Research methodology
- Key findings summary
- Citation information
- Related studies

#### Technology Category
- Product specifications
- Feature comparisons
- Release dates
- Technical specifications

## Performance Optimizations

### 1. Conditional Rendering
- Category sections only render when data is available
- Lazy loading of category-specific content

### 2. Memoization
```typescript
const CategorySections = React.memo<CategorySectionsProps>(({ post, variant }) => {
  // Component implementation
});
```

### 3. Image Optimization
- Fallback images for missing stock data
- Error handling for failed image loads

## Error Handling

### 1. Data Validation
```typescript
const getStockData = (): StockResearchData | null => {
  if (!hasStockData()) return null;
  return post.research_data as StockResearchData;
};
```

### 2. Graceful Degradation
- Stock sections only render when data is available
- Fallback to standard blog post display
- Error boundaries for component failures

### 3. Type Safety
- TypeScript interfaces for all category data
- Runtime type checking for research data
- Optional chaining for nested data access

## Testing Strategy

### 1. Unit Tests
- Test category detection logic
- Test data transformation functions
- Test conditional rendering

### 2. Integration Tests
- Test complete card rendering with different categories
- Test modal interactions
- Test data flow from API to UI

### 3. Visual Regression Tests
- Test different category layouts
- Test responsive behavior
- Test accessibility features

## Future Enhancements

### 1. Dynamic Category Loading
- Lazy load category-specific components
- Code splitting by category
- Dynamic imports for new categories

### 2. Category-Specific Interactions
- Stock price alerts
- Sports team following
- News bookmarking
- Science paper citations

### 3. Personalization
- User preference-based category display
- Customizable category sections
- Adaptive content based on user behavior

### 4. Analytics Integration
- Category-specific engagement metrics
- A/B testing for different layouts
- Performance monitoring by category

## Best Practices

### 1. Code Organization
- Keep category logic in dedicated components
- Use consistent naming conventions
- Document complex business logic

### 2. Data Management
- Validate research data before rendering
- Handle missing or incomplete data gracefully
- Cache category-specific data when appropriate

### 3. User Experience
- Maintain consistent visual hierarchy
- Provide clear category indicators
- Ensure accessibility across all categories

### 4. Performance
- Optimize images and assets per category
- Implement proper loading states
- Monitor bundle size impact

## Conclusion

This architecture provides a robust, scalable foundation for category-specific content while maintaining code quality and performance. The single-component approach with category-specific sections offers the best balance of maintainability, consistency, and extensibility for our blog post system.

The implementation successfully demonstrates how to handle complex, data-rich content (like stock information) while keeping the codebase clean and maintainable. Future categories can be easily added following the established patterns and conventions. 