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
import logging
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta
import json
from dataclasses import dataclass, asdict
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

# Configure logging
#TODO move logging to its own file to be used throughout project (improves modularity)
#! Deprecated (use logger in app.py)
logger = logging.getLogger(__name__)
# Remove NullHandler to allow logs to propagate to Railway


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
    # regular_market_price: Optional[float] = None
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
    sentiment: Optional[str] = None
    sentiment_score: Optional[int] = None
    sentiment_confidence: Optional[float] = None

    # Timestamps
    # timestamp: Optional[datetime] = None


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

    def verify_user(self, user_id: str) -> bool:
        """
        Verifies the user id is an authenticated user within supabase.

        Args:
            user_id: the id of the user

        Returns:
            True if user exists, otherwise False.
        """
        try:
            logger.info(f"Starting verify_user operation for user_id: {user_id}")
            
            result = (
                self.client.table("profiles").select("*").eq("id", user_id).single()
            )

            if result:
                logger.info(f"User verified successfully: {user_id}")
                return {
                    "success": True,
                    "data": result.data[0],
                    "message": "User verified",
                }
            else:
                logger.warning(f"User not found in database: {user_id}")
                raise Exception("User does not exists within DB")

        except Exception as e:
            logger.error(f"Failed to verify user {user_id}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": f"{e} | User id '{user_id}' not found within DB",
                "timestamp": datetime.now().isoformat(),
            }

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

    def save_stock_research(self, research_data: Union[StockResearch, Dict]) -> Dict[str, Any]:
        """
        Save comprehensive stock research data to the database.

        Args:
            research_data: StockResearch object or dictionary containing the data to save

        Returns:
            Dict containing success status and saved data or error information
        """
        try:
            logger.info("Starting save_stock_research operation")
            logger.info("Research data: %s", research_data)

            
            # Handle both StockResearch objects and dictionaries
            if isinstance(research_data, StockResearch):
                data_dict = asdict(research_data)
                ticker = research_data.ticker
            elif isinstance(research_data, dict):
                data_dict = research_data.copy()
                ticker = research_data.get("ticker", "unknown")
            else:
                raise ValueError("research_data must be either StockResearch object or dictionary")

            # Set research date if not provided
            # if not data_dict.get("research_date"):
            #     data_dict["research_date"] = datetime.now().isoformat()

            # Remove None values to avoid database issues
            data_dict = {k: v for k, v in data_dict.items() if v is not None}

            # Insert into database
            result = self.client.table("stock_research").insert(data_dict).execute()

            if result.data:
                logger.info(f"Stock research saved successfully for {ticker}. Record ID: {result.data[0].get('id', 'unknown')}")
                return {
                    "success": True,
                    "data": result.data[0],
                    "message": "Stock research saved successfully",
                }
            else:
                logger.error(f"No data returned from insert operation for {ticker}")
                raise Exception("No data returned from insert operation")

        except Exception as e:
            ticker_name = ticker if 'ticker' in locals() else "unknown"
            logger.error(f"Failed to save stock research for {ticker_name}: {str(e)}", exc_info=True)
            return self._handle_database_error(
                e, f"save_stock_research for {ticker_name}"
            )

    def get_stock_research(
        self, ticker: str, max_age_hours: int = 24
    ) -> Dict[str, Any]:
        """
        Retrieve recent stock research data by ticker.

        Args:
            ticker: The stock ticker to search for
            max_age_hours: Maximum age of data to consider recent (default: 24 hours)

        Returns:
            Dict containing success status and research data or error information
        """
        try:
            logger.info(f"Starting get_stock_research operation for ticker: {ticker}, max_age_hours: {max_age_hours}")
            
            # Calculate cutoff time for recent data
            cutoff_time = datetime.now() - timedelta(hours=max_age_hours)

            result = (
                self.client.table("stock_research")
                .select("*")
                .eq("ticker", ticker.upper())
                .gte("research_date", cutoff_time.isoformat())
                .order("research_date", desc=True)
                .limit(1)
                .execute()
            )

            if result.data:
                logger.info(f"Stock research retrieved successfully for {ticker}. Found {len(result.data)} records")
                return {
                    "success": True,
                    "data": result.data[0],
                    "message": "Stock research found",
                }
            else:
                logger.info(f"No recent stock research found for {ticker} within {max_age_hours} hours")
                return {
                    "success": False,
                    "error": f"No recent stock research found: {ticker}",
                    "data": None,
                }

        except Exception as e:
            logger.error(f"Failed to get stock research for {ticker}: {str(e)}", exc_info=True)
            return self._handle_database_error(e, f"get_stock_research for {ticker}")

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
                raise ValueError("blog_data must be either BlogPost object or dictionary")

            # Convert tags list to array format for PostgreSQL
            if data_dict.get("tags") and isinstance(data_dict["tags"], list):
                # PostgreSQL array format
                pass  # Supabase handles list conversion automatically

            # Remove None values
            data_dict = {k: v for k, v in data_dict.items() if v is not None}

            # Insert into database
            result = self.client.table("blog_posts").insert(data_dict).execute()

            if result.data:
                logger.info(f"Blog post saved successfully for {ticker}. Title: {title}. Record ID: {result.data[0].get('id', 'unknown')}")
                return {
                    "success": True,
                    "data": result.data[0],
                    "message": "Blog post saved successfully",
                }
            else:
                logger.error(f"No data returned from blog post insert operation for {ticker}")
                raise Exception("No data returned from insert operation")

        except Exception as e:
            logger.error(f"Failed to save blog post for {ticker}: {str(e)}", exc_info=True)
            return self._handle_database_error(
                e, f"save_blog_post for {ticker}"
            )

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
            logger.info(f"Starting get_blog_posts_by_ticker operation for ticker: {ticker}, limit: {limit}, index: {index}")
            
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
            logger.error(f"Failed to get blog posts for {ticker}: {str(e)}", exc_info=True)
            return self._handle_database_error(
                e, f"get_blog_posts_by_ticker for {ticker}"
            )

    def save_to_cache(
        self, ticker: str, cache_key: str, data: Dict, expires_hours: int = 24
    ) -> Dict[str, Any]:
        """
        Save data to the research cache.

        Args:
            ticker: The stock ticker
            cache_key: Unique key for this cache entry
            data: Data to cache
            expires_hours: Cache expiration time in hours

        Returns:
            Dict containing success status
        """
        try:
            logger.info(f"Starting save_to_cache operation for ticker: {ticker}, cache_key: {cache_key}, expires_hours: {expires_hours}")
            
            expires_at = datetime.now() + timedelta(hours=expires_hours)
            logger.info(f"Cache will expire at: {expires_at.isoformat()}")

            cache_data = {
                "ticker": ticker.upper(),
                "cache_key": cache_key,
                "cached_data": data,
                "expires_at": expires_at.isoformat(),
            }

            logger.info(f"Prepared cache data for {ticker} with {len(cache_data)} fields")

            # Use upsert to handle duplicates
            result = (
                self.client.table("research_cache")
                # upsert:
                # - If the record doesn't exist: It performs an INSERT operation
                # - If the record already exists: It performs an UPDATE operation
                .upsert(cache_data, on_conflict="ticker,cache_key").execute()
            )

            if result.data:
                logger.info(f"Data cached successfully for {ticker} - {cache_key}. Record ID: {result.data[0].get('id', 'unknown')}")
                return {
                    "success": True,
                    "data": result.data[0],
                    "message": "Data cached successfully",
                }
            else:
                logger.error(f"No data returned from cache operation for {ticker} - {cache_key}")
                raise Exception("No data returned from cache operation")

        except Exception as e:
            logger.error(f"Failed to save cache for {ticker} - {cache_key}: {str(e)}", exc_info=True)
            return self._handle_database_error(e, f"save_to_cache for {ticker}")

    def get_from_cache(self, ticker: str, cache_key: str) -> Dict[str, Any]:
        """
        Retrieve data from cache if not expired.

        Args:
            ticker: The stock ticker
            cache_key: Cache key to retrieve

        Returns:
            Dict containing cached data or None if expired/not found
        """
        try:
            logger.info(f"Starting get_from_cache operation for ticker: {ticker}, cache_key: {cache_key}")
            
            result = (
                self.client.table("research_cache")
                .select("*")
                .eq("ticker", ticker.upper())
                .eq("cache_key", cache_key)
                .gt("expires_at", datetime.now().isoformat())
                .execute()
            )

            if result.data:
                logger.info(f"Cache hit for {ticker} - {cache_key}. Updating hit count and last accessed")
                
                # Update hit count and last accessed
                cache_id = result.data[0]["id"]
                self.client.table("research_cache").update(
                    {
                        "hit_count": result.data[0]["hit_count"] + 1,
                        "last_accessed": datetime.now().isoformat(),
                    }
                ).eq("id", cache_id).execute()

                logger.info(f"Cache hit: {ticker} - {cache_key}")
                return {
                    "success": True,
                    "data": result.data[0]["cached_data"],
                    "message": "Cache hit",
                }
            else:
                logger.info(f"Cache miss or expired for {ticker} - {cache_key}")
                return {
                    "success": False,
                    "error": "Cache miss or expired",
                    "data": None,
                }

        except Exception as e:
            logger.error(f"Failed to get from cache for {ticker} - {cache_key}: {str(e)}", exc_info=True)
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
            logger.info(f"Starting get_recent_research_with_blogs operation with limit: {limit}")
            
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
            logger.error(f"Failed to get recent research with blogs: {str(e)}", exc_info=True)
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


# Global instance for use across the application
supabase_service = SupabaseService()
