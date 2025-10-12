"""
Stock Research Service Layer

This module provides a centralized interface for stock research operations.
It orchestrates yFinance research, caching, and database operations.

Architecture:
- Service layer pattern that coordinates multiple data sources
- Handles caching logic to minimize API calls
- Integrates with Supabase for data persistence
- Provides clean separation between research and blog generation

Key Responsibilities:
- Fetch stock research data from yFinance
- Manage research data caching
- Save research data to database
- Validate and format research data
"""

from typing import Dict, Any, Optional
from log.logging_config import get_logger
from services.yfinance_service import perform_yfinance_research

from datetime import datetime, timedelta, timezone


logger = get_logger(__name__)


class StockResearchService:
    """
    Service class for managing stock research operations.

    This service provides a clean interface for research operations with:
    - Intelligent caching to reduce API calls
    - Database integration for persistence
    - Error handling and validation
    - Separation of concerns from blog generation

    Example Usage:
        research_service = StockResearchService(supabase_service)
        result = research_service.get_research_data(
            ticker="AAPL",
            use_cache=True,
            save_to_db=True
        )

        if result["success"]:
            research_data = result["data"]
            # Use research_data for blog generation or other purposes
    """

    def __init__(self, supabase_service=None):
        """
        Initialize the research service.

        Args:
            supabase_service: Optional Supabase service instance for caching/storage
        """
        self.supabase_service = supabase_service
        logger.info("StockResearchService initialized")

    def get_research_data(
        self,
        ticker: str,
        use_cache: bool | None = True,
        save_to_db: bool | None = True,
    ) -> Dict[str, Any]:
        """
        Get comprehensive research data for a stock ticker.

        This method orchestrates the full research process:
        1. Check cache for recent data (if enabled)
        2. Fetch fresh data from yFinance if needed
        3. Save to database (if requested)
        4. Cache the results (if caching enabled)

        Args:
            ticker: Stock ticker symbol (e.g., "AAPL", "GOOGL")
            use_cache: Whether to check/use cached data
            save_to_db: Whether to persist research data to database

        Returns:
            Dict containing:
                - success (bool): Whether the operation succeeded
                - data (dict): Research data if successful
                - data_source (str): Source of the data
                - cached (bool): Whether data came from cache or was successfully saved
                - research_id (str, optional): Database ID if saved
                - timestamp (str): ISO 8601 UTC timestamp
                - error (str, optional): Error message if failed

        Example Response:
            {
                "success": True,
                "data": {
                    "ticker": "AAPL",
                    "company_name": "Apple Inc.",
                    "current_price": 175.50,
                    "price_change_percent": 1.27,
                    ...
                },
                "data_source": "yfinance"
                "cached": True,
                "research_id": null
            }
        """
        # Time stamp with proper timezone support
        timestamp = datetime.now(timezone.utc).isoformat()
        
        try:
            ticker = ticker.strip().upper()
            logger.info(
                f"Getting research data for {ticker} (cache={use_cache}, save={save_to_db})"
            )

            cached_research = None
            research_id = None
            is_cached = False
            data_source = "yFinance"  # Default to fresh data

            # Step 1: Check cache if enabled
            if use_cache and self.supabase_service:
                cached_research = self._get_cached_research(ticker)
                if cached_research:
                    logger.info(f"Using cached research data for {ticker}")
                    return {
                        "success": True,
                        "data": cached_research,
                        "data_source": data_source,
                        "from_cache": True, #TODO apply to metadata,
                        "cached": True,
                        "research_id": cached_research.get("id"),
                        "cache_info": {
                            "from_cache": True,
                            "cache_age": "recent",
                            "cache_type": "database_cache",
                        },
                        "timestamp":timestamp
                    }

            # Step 2: Fetch fresh research data from yFinance
            research_results = perform_yfinance_research(ticker)

            if not research_results.get("data"):
                logger.error(f"Research for {ticker} returned no data")
                return {
                    "success": False,
                    "error": "Research results does not include data object",
                    "data_source": "none",
                    "cached": False,
                    "timestamp":timestamp

                }

            research_data = research_results["data"]

            # Step 3: Save to database if requested
            if save_to_db and self.supabase_service:
                research_id = self._save_research(research_data)
                # If save was successful, mark as cached since it's now in the database
                if research_id:
                    is_cached = True
                    logger.info(
                        f"Data for {ticker} is now cached in database (ID: {research_id})"
                    )

            return {
                "success": True,
                "data": research_data,
                "data_source": data_source,
                "cached": is_cached,
                "research_id": research_id,
                "cache_info": {
                    "from_cache": False,
                    "saved_to_database": bool(research_id),
                    "cached_for_future": is_cached,
                },
                "timestamp":timestamp
            }

        except Exception as e:
            logger.error(f"Research failed for {ticker}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": f"Research failed: {str(e)}",
                "data_source": "none",
                "cached": False,
                "timestamp":timestamp
            }

    def _get_cached_research(self, ticker: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve cached research data from database.

        Args:
            ticker: Stock ticker symbol

        Returns:
            Cached research data if available and recent, None otherwise
        """
        try:
            if not self.supabase_service:
                return None

            cache_result = self.supabase_service.get_from_cache(ticker)
            if cache_result.get("success"):
                return cache_result.get("data")
            return None

        except Exception as e:
            logger.warning(f"Cache retrieval failed for {ticker}: {str(e)}")
            return None

    def _save_research(self, research_data: Dict[str, Any]) -> Optional[str]:
        """
        Save research data to database.

        Args:
            research_data: Research data to save

        Returns:
            Database ID of saved research, or None if failed
        """
        try:
            if not self.supabase_service:
                return None

            result = self.supabase_service.save_stock_research(research_data)

            if result and result.get("data", {}).get("id"):
                research_id = result["data"]["id"]
                logger.info(f"Research saved with ID: {research_id}")
                return research_id

            logger.warning("Research save returned no ID")
            return None

        except Exception as e:
            logger.error(f"Failed to save research: {str(e)}", exc_info=True)
            return None


# Global instance for use across the application
# Note: This will be initialized with supabase_service when first used
stock_research_service = None

def get_research_service():
    """
    Factory function to get research service instance.
    Uses lazy loading to avoid circular imports.
    """
    global stock_research_service
    if stock_research_service is None:
        try:
            from services.supabase_service import supabase_service

            stock_research_service = StockResearchService(supabase_service)
        except Exception as e:
            logger.warning(f"Could not initialize research service with Supabase: {e}")
            stock_research_service = StockResearchService(None)
    return stock_research_service
