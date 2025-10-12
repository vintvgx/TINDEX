/**
 * Example Usage Component
 * 
 * This file demonstrates various ways to use the watchlist hooks
 * in your React Native components. Copy and adapt these examples
 * for your specific use cases.
 */

import React from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useBiggestGainers } from './useBiggestGainers';
import type { BiggestGainerStock } from './useBiggestGainers';

// ============================================================================
// EXAMPLE 1: Basic Implementation
// ============================================================================

export function BasicBiggestGainersExample() {
  const { data, isLoading, error } = useBiggestGainers();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text>Loading biggest gainers...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Error: {error.message}</Text>
      </View>
    );
  }

  if (!data?.success || !data.data) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to load data</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Biggest Gainers</Text>
      <FlatList
        data={data.data}
        keyExtractor={(item) => item.ticker}
        renderItem={({ item }) => <StockItem stock={item} />}
      />
    </View>
  );
}

// ============================================================================
// EXAMPLE 2: Advanced with Custom Options
// ============================================================================

export function AdvancedBiggestGainersExample() {
  const { 
    data, 
    isLoading, 
    isFetching,
    error, 
    refetch,
    isRefetching 
  } = useBiggestGainers({
    limit: 30,                    // Fetch 30 stocks
    use_cache: true,              // Use cache if available
    staleTime: 3 * 60 * 1000,     // 3 minutes stale time
    retry: 3,                     // Retry 3 times on failure
    refetchOnMount: false,        // Don't refetch on mount
    refetchOnWindowFocus: false,  // Don't refetch on focus
  });

  const handleRefresh = () => {
    refetch();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Biggest Gainers (Top 30)</Text>
        <TouchableOpacity 
          onPress={handleRefresh}
          disabled={isFetching}
          style={styles.refreshButton}
        >
          <Text style={styles.refreshButtonText}>
            {isRefetching ? 'Refreshing...' : 'Refresh'}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load data</Text>
          <Text style={styles.errorSubtext}>{error.message}</Text>
          <TouchableOpacity onPress={handleRefresh} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {data?.success && (
        <>
          {data.from_cache && (
            <Text style={styles.cacheIndicator}>Showing cached data</Text>
          )}
          <FlatList
            data={data.data}
            keyExtractor={(item) => item.ticker}
            renderItem={({ item }) => <StockItem stock={item} />}
            refreshing={isRefetching}
            onRefresh={handleRefresh}
          />
        </>
      )}
    </View>
  );
}

// ============================================================================
// EXAMPLE 3: Conditional Fetching Based on Tab State
// ============================================================================

interface ConditionalExampleProps {
  isWatchlistTabActive: boolean;
}

export function ConditionalFetchExample({ isWatchlistTabActive }: ConditionalExampleProps) {
  const { data, isLoading } = useBiggestGainers({
    enabled: isWatchlistTabActive, // Only fetch when tab is active
  });

  // Component won't make API calls until isWatchlistTabActive is true
  // This is useful for tab-based navigation where you only want to
  // load data when the user is viewing that specific tab

  if (!isWatchlistTabActive) {
    return null;
  }

  if (isLoading) {
    return <ActivityIndicator />;
  }

  return (
    <View style={styles.container}>
      {data?.data.map((stock) => (
        <StockItem key={stock.ticker} stock={stock} />
      ))}
    </View>
  );
}

// ============================================================================
// EXAMPLE 4: Multiple Watchlists with Different Limits
// ============================================================================

export function MultipleWatchlistsExample() {
  // Fetch different quantities for different use cases
  const topGainers = useBiggestGainers({ limit: 5 });   // Top 5 for hero section
  const allGainers = useBiggestGainers({ limit: 50 });  // All for full list

  return (
    <View style={styles.container}>
      {/* Hero Section - Top 5 */}
      <View style={styles.heroSection}>
        <Text style={styles.sectionTitle}>Top 5 Gainers</Text>
        {topGainers.data?.data.slice(0, 5).map((stock) => (
          <StockItem key={stock.ticker} stock={stock} highlight />
        ))}
      </View>

      {/* Full List */}
      <View style={styles.fullListSection}>
        <Text style={styles.sectionTitle}>All Gainers</Text>
        <FlatList
          data={allGainers.data?.data}
          keyExtractor={(item) => item.ticker}
          renderItem={({ item }) => <StockItem stock={item} />}
        />
      </View>
    </View>
  );
}

// ============================================================================
// EXAMPLE 5: With Search/Filter Functionality
// ============================================================================

export function FilteredBiggestGainersExample() {
  const [searchTerm, setSearchTerm] = React.useState('');
  const { data, isLoading } = useBiggestGainers({ limit: 50 });

  const filteredStocks = React.useMemo(() => {
    if (!data?.data) return [];
    if (!searchTerm) return data.data;

    return data.data.filter(stock => 
      stock.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
      stock.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [data, searchTerm]);

  return (
    <View style={styles.container}>
      {/* Search input would go here */}
      {/* <SearchInput value={searchTerm} onChange={setSearchTerm} /> */}
      
      {isLoading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={filteredStocks}
          keyExtractor={(item) => item.ticker}
          renderItem={({ item }) => <StockItem stock={item} />}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No stocks found matching "{searchTerm}"
            </Text>
          }
        />
      )}
    </View>
  );
}

// ============================================================================
// EXAMPLE 6: With Background Refetch
// ============================================================================

export function AutoRefreshExample() {
  const { data, isLoading, dataUpdatedAt } = useBiggestGainers({
    staleTime: 2 * 60 * 1000,        // 2 minutes
    refetchInterval: 5 * 60 * 1000,  // Auto-refetch every 5 minutes
  });

  const lastUpdated = React.useMemo(() => {
    if (!dataUpdatedAt) return 'Never';
    const date = new Date(dataUpdatedAt);
    return date.toLocaleTimeString();
  }, [dataUpdatedAt]);

  return (
    <View style={styles.container}>
      <Text style={styles.lastUpdated}>Last updated: {lastUpdated}</Text>
      {isLoading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={data?.data}
          keyExtractor={(item) => item.ticker}
          renderItem={({ item }) => <StockItem stock={item} />}
        />
      )}
    </View>
  );
}

// ============================================================================
// REUSABLE COMPONENTS
// ============================================================================

interface StockItemProps {
  stock: BiggestGainerStock;
  highlight?: boolean;
}

function StockItem({ stock, highlight = false }: StockItemProps) {
  const isPositive = stock.changesPercentage > 0;
  
  return (
    <TouchableOpacity 
      style={[styles.stockItem, highlight && styles.stockItemHighlight]}
    >
      <View style={styles.stockInfo}>
        <Text style={styles.stockTicker}>{stock.ticker}</Text>
        <Text style={styles.stockName}>{stock.name}</Text>
      </View>
      
      <View style={styles.stockMetrics}>
        <Text style={styles.stockPrice}>${stock.price.toFixed(2)}</Text>
        <Text style={[
          styles.stockChange,
          isPositive ? styles.positive : styles.negative
        ]}>
          {isPositive ? '+' : ''}{stock.changesPercentage.toFixed(2)}%
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  refreshButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorSubtext: {
    color: '#8E8E93',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  cacheIndicator: {
    fontSize: 12,
    color: '#8E8E93',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  stockItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    marginBottom: 8,
  },
  stockItemHighlight: {
    backgroundColor: '#E5E5EA',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  stockInfo: {
    flex: 1,
  },
  stockTicker: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  stockName: {
    fontSize: 14,
    color: '#8E8E93',
  },
  stockMetrics: {
    alignItems: 'flex-end',
  },
  stockPrice: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  stockChange: {
    fontSize: 14,
    fontWeight: '600',
  },
  positive: {
    color: '#34C759',
  },
  negative: {
    color: '#FF3B30',
  },
  heroSection: {
    marginBottom: 24,
  },
  fullListSection: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    color: '#8E8E93',
    fontSize: 16,
    marginTop: 20,
  },
  lastUpdated: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'right',
    marginBottom: 8,
  },
});

// ============================================================================
// USAGE IN YOUR APP
// ============================================================================

/*
// In your screen/page component:

import { BasicBiggestGainersExample } from '@/hooks/queries/watchlist/example';

export default function WatchlistScreen() {
  return <BasicBiggestGainersExample />;
}

// Or just use the hook directly:

import { useBiggestGainers } from '@/hooks/queries/watchlist';

export default function MyScreen() {
  const { data, isLoading, error } = useBiggestGainers();
  
  // Your component logic...
}
*/

