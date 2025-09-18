"""
Cache utilities for the application.

Process: 
 - # utils/cache.py defines the what and how for the cache functionality
 - #__init__.py, converts utils as a package so that it can be imported
 - in # app.py instead of defining as (from utils.cache import TrendingStocksCache) can just call (utils import TrendingStockCache)

This module provides TTL-based caching functionality for reducing external API calls
and improving application performance.
"""
import time
from typing import Optional


class TrendingStocksCache:
    """
    Simple process-local TTL cache for trending stocks data.
    Uses monotonic time to avoid clock adjustment issues.
    
    Thread-safe for single-process use. For multi-process applications,
    consider using Redis or another distributed cache.
    """
    
    def __init__(self):
        self.cache = {}
    
    def get(self, key: str) -> Optional[dict]:
        """
        Get cached data if not expired, otherwise return None.
        
        Args:
            key: Cache key to retrieve
            
        Returns:
            Cached data if valid and not expired, None otherwise
        """
        if key not in self.cache:
            return None
        
        entry = self.cache[key]
        if time.monotonic() > entry['expires_at']:
            # Entry expired, remove it
            del self.cache[key]
            return None
        
        return entry['data']
    
    def set(self, key: str, data: dict, ttl_seconds: int):
        """
        Store data in cache with TTL.
        
        Args:
            key: Cache key
            data: Data to cache
            ttl_seconds: Time to live in seconds
        """
        self.cache[key] = {
            'data': data,
            'expires_at': time.monotonic() + ttl_seconds
        }
    
    def clear(self):
        """Clear all cached entries."""
        self.cache.clear()
    
    def size(self) -> int:
        """Get the number of items in cache."""
        return len(self.cache)
    
    def keys(self) -> list:
        """Get all cache keys (for debugging)."""
        return list(self.cache.keys())
    
    def remove(self, key: str) -> bool:
        """
        Remove a specific key from cache.
        
        Args:
            key: Cache key to remove
            
        Returns:
            True if key was removed, False if key didn't exist
        """
        if key in self.cache:
            del self.cache[key]
            return True
        return False


class GenericTTLCache:
    """
    Generic TTL cache that can be used for any type of data.
    Useful for other endpoints that might need caching.
    """
    
    def __init__(self):
        self.cache = {}
    
    def get(self, key: str) -> Optional[any]:
        """Get cached data if not expired."""
        if key not in self.cache:
            return None
        
        entry = self.cache[key]
        if time.monotonic() > entry['expires_at']:
            del self.cache[key]
            return None
        
        return entry['data']
    
    def set(self, key: str, data: any, ttl_seconds: int):
        """Store data in cache with TTL."""
        self.cache[key] = {
            'data': data,
            'expires_at': time.monotonic() + ttl_seconds
        }
    
    def clear(self):
        """Clear all cached entries."""
        self.cache.clear()