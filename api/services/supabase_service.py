"""
Supabase Service Layer

This module provides a centralized interface for all Supabase database operations.
It encapsulates database logic, provides type safety, and handles errors consistently.

Architecture:
- Service layer pattern for database operations
- Centralized error handling and logging
- Type-safe operations with proper validation
- Connection management and retry logic
"""

import os
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, asdict
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
from log.logging_config import get_logger
from utils.exceptions import UserNotFoundError

logger = get_logger(__name__)


@dataclass
class StockResearch:
    """Data class for comprehensive stock research data"""

    # Company Details
    ticker: str
    company_name: Optional[str] = None
    description: Optional[str] = None

    # Market Data
    current_price: Optional[float] = None
    price_change: Optional[float] = None
    price_change_percent: Optional[float] = None
    volume: Optional[int] = None
    day_high: Optional[float] = None
    day_low: Optional[float] = None
    year_high: Optional[float] = None
    year_low: Optional[float] = None
    average_volume: Optional[int] = None

    # Financial Metrics
    market_cap: Optional[int] = None
    market_state: Optional[str] = None
    regular_market_price: Optional[float] = None
    # regular_market_volume: Optional[float] = None
    pe_ratio: Optional[float] = None
    price_to_book: Optional[float] = None
    dividend_yield: Optional[float] = None
    beta: Optional[float] = None
    return_on_equity: Optional[float] = None
    revenue_growth: Optional[float] = None
    profit_margins: Optional[float] = None
    debt_to_equity: Optional[float] = None
    earnings_growth: Optional[float] = None

    # Company Info
    sector: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    currency: Optional[str] = None
    exchange: Optional[str] = None
    employees: Optional[int] = None
    website: Optional[str] = None

    # Additional data (stored as JSON)
    recommendations: Optional[Dict] = None
    historical_data: Optional[Dict] = None
    news_data: Optional[List] = None

    # Sentiment Analysis
    sentiment: Optional[Dict[str, Any]] = None
    sentiment_score: Optional[int] = None
    sentiment_confidence: Optional[float] = None
    
    # Cache expiration
    expires_at: Optional[datetime] = None


@dataclass
class BlogPost:
    """Data class for blog post data"""

    ticker: str
    title: str
    content: str
    word_count: Optional[int] = None
    reading_time: Optional[int] = None
    stock_research_id: Optional[str] = None
    research_data: Optional[Dict] = None
    model_used: Optional[str] = "claude-3-5-sonnet-20241022"
    target_length: Optional[int] = 800
    generation_prompt: Optional[str] = None
    tags: Optional[List[str]] = None
    category: Optional[str] = None
    excerpt: Optional[str] = None
    status: Optional[str] = "draft"
    published_at: Optional[datetime] = None
    user_id: Optional[str] = None
    
    
@dataclass
class WatchlistData:
    """Data class for watchlist cache"""
    
    watchlist_type: str  # 'biggest-gainers', 'trending', etc.
    data: List[Dict[str, Any]]  # The actual watchlist data
    symbol_count: Optional[int] = None
    expires_at: Optional[datetime] = None


class SupabaseService:
    """
    Service class for managing all Supabase database operations.

    This class provides a clean interface for database operations with:
    - Connection management
    - Error handling and retry logic
    - Type safety and validation
    - Logging and monitoring
    """

    def __init__(self):
        """Initialize Supabase client with environment variables"""
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.supabase_url or not self.supabase_key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables"
            )

        # Initialize Supabase client with retry options
        client_options = ClientOptions(
            schema="public",
            headers={"X-Client-Info": "alethia-api/1.0.0"},
            # Connection pooling
            auto_refresh_token=True,
            persist_session=True,
        )

        self.client: Client = create_client(
            self.supabase_url, self.supabase_key, options=client_options
        )

        self.max_retries = 3
        self.retry_delay = 1  # seconds

        logger.info("Supabase client initialized successfully")

    def verify_user(self, user_id: str | None) -> bool:
        """
        Verifies the user id is an authenticated user within supabase.

        Args:
            user_id: the id of the user

        Returns:
            True if user exists, otherwise False.
        """
        try:
            logger.info("Starting verify_user operation for user_id: %s", user_id)

            result = self.client.auth.admin.get_user_by_id(user_id)
            if getattr(result, "error", None):
                logger.error(
                    "Supabase error retrieving user %s: %s", user_id, result.error
                )
                raise RuntimeError(f"Error retrieving user: {result.error}")

            user = getattr(result, "user", None)
            if not user or user.id != user_id:
                logger.warning("User not found: %s", user_id)
                raise UserNotFoundError(f"User id '{user_id}' does not exist")

            logger.info("User verified successfully: %s", user_id)
            return True

        except UserNotFoundError:
            # Let callers decide how to handle missing users
            raise
        except Exception as e:
            logger.error("Failed to verify user %s: %s", user_id, e, exc_info=True)
            raise

    def _handle_database_error(
        self, error: Exception, operation: str
    ) -> Dict[str, Any]:
        """
        Centralized error handling for database operations.

        Args:
            error: The exception that occurred
            operation: Description of the operation that failed

        Returns:
            Dict containing error information
        """
        error_msg = f"Database operation failed: {operation} - {str(error)}"
        logger.error(error_msg, exc_info=True)

        return {
            "success": False,
            "error": error_msg,
            "operation": operation,
            "timestamp": datetime.now().isoformat(),
        }

    def save_stock_research(
        self, research_data: Union[StockResearch, Dict]
    ) -> Dict[str, Any]:
        """
        Saves stock data to the database using database-level upsert logic.
        - Preserves created_at on updates
        - Automatically updates updated_at via trigger
        - Single database operation (no separate SELECT)
        
        Args:
            research_data: StockResearch object or dictionary containing the data to save
        
        Returns:
            Dict containing success status and saved data or error information
        """
        try:
            logger.info("Starting save_stock_research operation")
            
            # Handle both StockResearch objects and dictionaries
            if isinstance(research_data, StockResearch):
                data_dict = asdict(research_data)
                ticker = research_data.ticker
            elif isinstance(research_data, dict):
                data_dict = research_data.copy()
                ticker = research_data.get("ticker", "unknown")
            else:
                raise ValueError(
                    "research_data must be either StockResearch object or dictionary"
                )
            
            ticker = ticker.upper()
            data_dict["ticker"] = ticker # upsert capitalized ticker (deduplication)
            logger.info(f"Processing stock research for ticker: {ticker}")
            
            # Remove None values to avoid database issues
            data_dict = {k: v for k, v in data_dict.items() if v is not None}
            
            # Call the PostgreSQL function - pass dict directly, not JSON string
            result = self.client.rpc(
                'upsert_stock_research', 
                {'p_data': data_dict}  # ✅ Pass dict directly
            ).execute()
            
            if result.data and len(result.data) > 0:
                record = result.data[0]
                is_update = record.pop('is_update', False)
                operation_type = "updated" if is_update else "created"
                
                logger.info(
                    f"Stock research {operation_type} successfully for {ticker} (ID: {record.get('id', 'unknown')})"
                )
                
                return {
                    "success": True,
                    "data": record,
                    "is_update": is_update,
                    "message": f"Stock research {operation_type} successfully",
                }
            else:
                logger.error(f"No data returned from upsert operation for {ticker}")
                raise Exception("No data returned from upsert operation")
        
        except Exception as e:
            ticker_name = ticker if "ticker" in locals() else "unknown"
            logger.error(
                f"Failed to save stock research for {ticker_name}: {str(e)}",  # ✅ Removed data_json reference
                exc_info=True,
            )
            return self._handle_database_error(
                e, f"save_stock_research for {ticker_name}"
            )

    def save_blog_post(self, blog_data: Union[BlogPost, Dict]) -> Dict[str, Any]:
        """
        Save blog post data to the database.

        Args:
            blog_data: BlogPost object or dictionary containing the blog data

        Returns:
            Dict containing success status and saved data or error information
        """
        try:
            logger.info("Starting save_blog_post operation")

            # Initialize variables
            title = "unknown"
            ticker = "unknown"

            # Handle both BlogPost objects and dictionaries
            if isinstance(blog_data, BlogPost):
                data_dict = asdict(blog_data)
                title = blog_data.title
                ticker = blog_data.ticker
            elif isinstance(blog_data, dict):
                data_dict = blog_data.copy()
                title = blog_data.get("title", "unknown")
                ticker = blog_data.get("ticker", "unknown")
            else:
                raise ValueError(
                    "blog_data must be either BlogPost object or dictionary"
                )

            # Convert tags list to array format for PostgreSQL
            if data_dict.get("tags") and isinstance(data_dict["tags"], list):
                # PostgreSQL array format
                pass  # Supabase handles list conversion automatically

            # Remove None values
            data_dict = {k: v for k, v in data_dict.items() if v is not None}

            # Insert into database
            result = self.client.table("blog_posts").insert(data_dict).execute()

            if result.data:
                logger.info(
                    f"Blog post saved successfully for {ticker}. Title: {title}. Record ID: {result.data[0].get('id', 'unknown')}"
                )
                return {
                    "success": True,
                    "data": result.data[0],
                    "message": "Blog post saved successfully",
                }
            else:
                logger.error(
                    f"No data returned from blog post insert operation for {ticker}"
                )
                raise Exception("No data returned from insert operation")

        except Exception as e:
            logger.error(
                f"Failed to save blog post for {ticker}: {str(e)}", exc_info=True
            )
            return self._handle_database_error(e, f"save_blog_post for {ticker}")

    def get_blog_posts_by_ticker(
        self, ticker: str, limit: int = 10, index: int = 0
    ) -> Dict[str, Any]:
        """
        Retrieve blog posts for a specific ticker.
        TODO implement index

        Args:
            ticker: The stock ticker
            limit: Maximum number of posts to retrieve
            index: Index of where to start retrieving the post (assist in lazy loading in number of blog post)

        Returns:
            Dict containing success status and blog posts or error information
        """
        try:
            logger.info(
                f"Starting get_blog_posts_by_ticker operation for ticker: {ticker}, limit: {limit}, index: {index}"
            )

            result = (
                self.client.table("blog_posts")
                .select("*")
                .eq("ticker", ticker.upper())
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )

            logger.info(f"Retrieved {len(result.data)} blog posts for {ticker}")
            return {
                "success": True,
                "data": result.data,
                "message": f"Retrieved {len(result.data)} blog posts for {ticker}",
            }

        except Exception as e:
            logger.error(
                f"Failed to get blog posts for {ticker}: {str(e)}", exc_info=True
            )
            return self._handle_database_error(
                e, f"get_blog_posts_by_ticker for {ticker}"
            )

    def get_from_cache(self, ticker: str) -> Dict[str, Any]:
        """
        Retrieve complete stock research data from cache if not expired.
        Automatically updates updated_at timestamp via database function.

        Args:
            ticker: The stock ticker

        Returns:
            Dict containing all stock research data or None if expired/not found
        """
        try:
            logger.info(
                f"Starting get_from_cache operation for ticker: {ticker}"
            )

            # Call the PostgreSQL function - single database round trip
            # Returns all fields from stock_research table
            # updates hit_count & last_accessed within supabase
            result = self.client.rpc(
                'get_and_update_cache',
                {'p_ticker': ticker.upper()}
            ).execute()

            if result.data and len(result.data) > 0:
                logger.info(f"Cache hit: {ticker} - returning complete stock research object")
                return {
                    "success": True,
                    "data": result.data[0],  # Complete stock_research row as object
                    "message": "Cache hit",
                }
            else:
                logger.info(f"Cache miss or expired for {ticker}")
                return {
                    "success": False,
                    "error": "Cache miss or expired",
                    "data": None,
                }

        except Exception as e:
            logger.error(
                f"Failed to get from cache for {ticker}: {str(e)}",
                exc_info=True,
            )
            return self._handle_database_error(e, f"get_from_cache for {ticker}")

    def get_recent_research_with_blogs(self, limit: int = 10) -> Dict[str, Any]:
        """
        Get recent research data with associated blog posts using the view.

        Args:
            limit: Maximum number of results

        Returns:
            Dict containing recent research with blog data
        """
        try:
            logger.info(
                f"Starting get_recent_research_with_blogs operation with limit: {limit}"
            )

            result = (
                self.client.table("recent_research_with_blogs")
                .select("*")
                .limit(limit)
                .execute()
            )

            logger.info(
                f"Retrieved {len(result.data)} recent research entries with blogs"
            )
            return {
                "success": True,
                "data": result.data,
                "message": f"Retrieved {len(result.data)} recent research entries",
            }

        except Exception as e:
            logger.error(
                f"Failed to get recent research with blogs: {str(e)}", exc_info=True
            )
            return self._handle_database_error(e, "get_recent_research_with_blogs")

    def cleanup_expired_cache(self) -> Dict[str, Any]:
        """
        Clean up expired cache entries.

        Returns:
            Dict containing cleanup results
        """
        try:
            logger.info("Starting cleanup_expired_cache operation")

            result = (
                self.client.table("research_cache")
                .delete()
                .lt("expires_at", datetime.now().isoformat())
                .execute()
            )

            deleted_count = len(result.data) if result.data else 0
            logger.info(f"Cleaned up {deleted_count} expired cache entries")

            return {
                "success": True,
                "deleted_count": deleted_count,
                "message": f"Cleaned up {deleted_count} expired cache entries",
            }

        except Exception as e:
            logger.error(f"Failed to cleanup expired cache: {str(e)}", exc_info=True)
            return self._handle_database_error(e, "cleanup_expired_cache")
        
        
    def save_watchlist_cache(
        self, 
        watchlist_type: str, 
        data: List[Dict[str, Any]],
        ttl_hours: int = 24
    ) -> Dict[str, Any]:
        """
        Save or update watchlist data with automatic expiration.
        Uses database-level upsert logic similar to stock_research.
        
        Args:
            watchlist_type: Type of watchlist (e.g., 'biggest-gainers')
            data: List of stock data from the API
            ttl_hours: Time-to-live in hours (default 24)
        
        Returns:
            Dict containing success status and saved data
        """
        try:
            logger.info(f"Saving watchlist cache for type: {watchlist_type}")
            
            # Calculate expiration
            expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
            
            cache_data = {
                "watchlist_type": watchlist_type,
                "data": data,
                "symbol_count": len(data),
                "expires_at": expires_at.isoformat()
            }
            
            # Call PostgreSQL function for upsert
            result = self.client.rpc(
                'upsert_watchlist_cache',
                {'p_data': cache_data}
            ).execute()
            
            if result.data and len(result.data) > 0:
                record = result.data[0]
                is_update = record.pop('is_update', False)
                operation = "updated" if is_update else "created"
                
                logger.info(
                    f"Watchlist cache {operation} for {watchlist_type} "
                    f"with {len(data)} symbols (expires: {expires_at})"
                )
                
                return {
                    "success": True,
                    "data": record,
                    "is_update": is_update,
                    "message": f"Watchlist cache {operation} successfully"
                }
            else:
                raise Exception("No data returned from upsert operation")
                
        except Exception as e:
            logger.error(
                f"Failed to save watchlist cache for {watchlist_type}: {str(e)}",
                exc_info=True
            )
            return self._handle_database_error(
                e, f"save_watchlist_cache for {watchlist_type}"
            )
    
    def get_watchlist_cache(
        self, 
        watchlist_type: str,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Retrieve watchlist data from cache if not expired.
        Automatically updates access tracking via database function.
        
        Args:
            watchlist_type: Type of watchlist to retrieve
            force_refresh: If True, returns cache miss to force API call
        
        Returns:
            Dict with cache data or cache miss status
        """
        try:
            logger.info(
                f"Retrieving watchlist cache for type: {watchlist_type} "
                f"(force_refresh: {force_refresh})"
            )
            
            # If force refresh, skip cache check
            if force_refresh:
                logger.info(f"Force refresh requested for {watchlist_type}")
                return {
                    "success": False,
                    "error": "Force refresh requested",
                    "data": None,
                    "cache_miss": True
                }
            
            # Call PostgreSQL function - updates hit_count & last_accessed
            result = self.client.rpc(
                'get_and_update_watchlist_cache',
                {'p_watchlist_type': watchlist_type}
            ).execute()
            
            if result.data and len(result.data) > 0:
                cache_entry = result.data[0]
                logger.info(
                    f"Cache HIT for {watchlist_type} - "
                    f"{cache_entry.get('symbol_count', 0)} symbols"
                )
                return {
                    "success": True,
                    "data": cache_entry.get('data', []),
                    "cached_at": cache_entry.get('cached_at'),
                    "expires_at": cache_entry.get('expires_at'),
                    "cache_hit": True
                }
            else:
                logger.info(f"Cache MISS or expired for {watchlist_type}")
                return {
                    "success": False,
                    "error": "Cache miss or expired",
                    "data": None,
                    "cache_miss": True
                }
                
        except Exception as e:
            logger.error(
                f"Failed to get watchlist cache for {watchlist_type}: {str(e)}",
                exc_info=True
            )
            return self._handle_database_error(
                e, f"get_watchlist_cache for {watchlist_type}"
            )
    
    def get_all_watchlist_stats(self) -> Dict[str, Any]:
        """
        Get statistics for all cached watchlists.
        Useful for monitoring and debugging.
        
        Returns:
            Dict containing cache statistics
        """
        try:
            logger.info("Retrieving watchlist cache statistics")
            
            result = (
                self.client.table("watchlist_cache")
                .select("watchlist_type, symbol_count, cached_at, expires_at, hit_count, last_accessed")
                .order("cached_at", desc=True)
                .execute()
            )
            
            stats = []
            now = datetime.now(timezone.utc)
            
            for row in result.data:
                expires_at = datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00'))
                is_expired = expires_at < now
                time_until_expiry = expires_at - now if not is_expired else timedelta(0)
                
                stats.append({
                    "watchlist_type": row['watchlist_type'],
                    "symbol_count": row['symbol_count'],
                    "cached_at": row['cached_at'],
                    "expires_at": row['expires_at'],
                    "is_expired": is_expired,
                    "hours_until_expiry": time_until_expiry.total_seconds() / 3600,
                    "hit_count": row['hit_count'],
                    "last_accessed": row['last_accessed']
                })
            
            logger.info(f"Retrieved stats for {len(stats)} watchlist caches")
            return {
                "success": True,
                "data": stats,
                "message": f"Retrieved stats for {len(stats)} watchlist types"
            }
            
        except Exception as e:
            logger.error(
                f"Failed to get watchlist stats: {str(e)}",
                exc_info=True
            )
            return self._handle_database_error(e, "get_all_watchlist_stats")
    


_supabase_service = None

def get_supabase_service() -> SupabaseService:
    """
    Get or create the singleton SupabaseService instance.
    
    Returns:
        SupabaseService instance
        
    Raises:
        Exception: If service initialization fails
    """
    global _supabase_service
    
    if _supabase_service is None:
        try:
            _supabase_service = SupabaseService()
            logger.info("SupabaseService singleton created")
        except Exception as e:
            logger.error(f"Failed to initialize SupabaseService: {str(e)}", exc_info=True)
            raise Exception(f"Supabase service initialization failed: {str(e)}") from e
    
    return _supabase_service