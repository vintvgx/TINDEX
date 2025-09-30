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
from api.log.logging_config import get_logger
from api.services.yfinance_service import perform_yfinance_research

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
        save_to_db: bool | None = True
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
                - cached (bool): Whether data came from cache
                - research_id (str, optional): Database ID if saved
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
                "cached": False,
                "research_id": "uuid-here"
            }
        """
        try:
            ticker = ticker.strip().upper()
            logger.info(f"Getting research data for {ticker} (cache={use_cache}, save={save_to_db})")
            
            cached_research = None
            research_id = None
            
            # Step 1: Check cache if enabled
            if use_cache and self.supabase_service:
                cached_research = self._get_cached_research(ticker)
                if cached_research:
                    logger.info(f"Using cached research data for {ticker}")
                    return {
                        "success": True,
                        "data": cached_research,
                        "cached": True
                    }
            
            # Step 2: Fetch fresh research data from yFinance
            research_results = perform_yfinance_research(ticker)
            
            if not research_results.get("data"):
                logger.error(f"Research for {ticker} returned no data")
                return {
                    "success": False,
                    "error": "Research results does not include data object",
                    "cached": False
                }
            
            research_data = research_results["data"]
            
            # Step 3: Save to database if requested
            if save_to_db and self.supabase_service:
                research_id = self._save_research(research_data)
            
            # Step 4: Cache the research data if caching enabled
            if use_cache and self.supabase_service:
                self._cache_research(ticker, research_data)
            
            return {
                "success": True,
                "data": research_data,
                "cached": False,
                "research_id": research_id
            }
            
        except Exception as e:
            logger.error(f"Research failed for {ticker}: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": f"Research failed: {str(e)}",
                "cached": False
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
                
            cache_result = self.supabase_service.get_from_cache(ticker, "research_data")
            if cache_result.get("success"):
                return cache_result.get("data")
            return None
            
        except Exception as e:
            logger.warning(f"Cache retrieval failed for {ticker}: {str(e)}")
            return None
    
    def _cache_research(self, ticker: str, research_data: Dict[str, Any]) -> bool:
        """
        Cache research data in database.
        
        Args:
            ticker: Stock ticker symbol
            research_data: Research data to cache
            
        Returns:
            True if caching succeeded, False otherwise
        """
        try:
            if not self.supabase_service:
                return False
                
            self.supabase_service.save_to_cache(ticker, "research_data", research_data)
            logger.info(f"Cached research data for {ticker}")
            return True
            
        except Exception as e:
            logger.warning(f"Cache save failed for {ticker}: {str(e)}")
            return False
    
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
            from api.services.supabase_service import supabase_service
            stock_research_service = StockResearchService(supabase_service)
        except Exception as e:
            logger.warning(f"Could not initialize research service with Supabase: {e}")
            stock_research_service = StockResearchService(None)
    return stock_research_service
