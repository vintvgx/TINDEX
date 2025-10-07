"""
Watchlist Service - Retrieves various stock watchlists from multiple sources
"""

import os
import requests
from datetime import datetime, timezone
from typing import Dict, List, Optional
from log.logging_config import get_logger

logger = get_logger(__name__)


class WatchlistService:
    """Service for fetching various stock watchlists.
    NOTE: Currently using Financial Modeling Grep as the solo api for watch list fetching
    """

    def __init__(self):
        # Financial Modeling Prep API key
        # https://financialmodelingprep.com/stable/biggest-gainers?apikey=YTjrOXjoHUQVz7QcyfVN8RYXeEB3u4fK
        self.fmp_api_key = os.getenv("FMP_API_KEY")
        self.fmp_base_url = "https://financialmodelingprep.com/stable/"
        # self.fmp_base_url_v4 = "https://financialmodelingprep.com/api/v4"
        
        # Debug logging for API key status
        if self.fmp_api_key:
            logger.info(f"FMP API key loaded successfully (length: {len(self.fmp_api_key)})")
        else:
            logger.error("FMP_API_KEY environment variable is not set!")

    def get_biggest_gainers(self, limit: int = 20) -> Dict:
        """
        Get biggest gaining stocks.

        Args:
            limit: Number of stocks to return (default: 20)

        Returns:
        Dict with success status and list of gaining stocks
        """
        try:
            # Validate API key before making request
            if not self.fmp_api_key:
                logger.error("FMP API key is not configured")
                return {
                    "success": False,
                    "error": "FMP API key is not configured. Please set FMP_API_KEY environment variable."
                }
            
            url = f"{self.fmp_base_url}biggest-gainers"
            params = {
                "apikey": self.fmp_api_key,
                "limit": limit 
            }

            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()

            # Use Python slicing as backup if API doesn't respect limit
            limited_data = data[:limit] if isinstance(data, list) and len(data) > limit else data

            return {
                "success": True,
                "data": limited_data
            }
        except Exception as e:
            logger.error(f"Failed to fetch biggest gainers: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    # def get_trending_stocks(self, limit: int = 20) -> Dict:
    #     """
    #     Get trending stocks based on unusual volume and price movement.

    #     Args:
    #         limit: Number of stocks to return

    #     Returns:
    #         Dict with success status and list of trending stocks
    #     """
    #     try:
    #         # FMP provides "actives" which are stocks with high volume
    #         url = f"{self.fmp_base_url}/stock_market/actives"
    #         params = {"apikey": self.fmp_api_key}

    #         response = requests.get(url, params=params, timeout=30)
    #         response.raise_for_status()
    #         data = response.json()

    #         stocks = []
    #         for stock in data[:limit]:
    #             stocks.append(
    #                 {
    #                     "ticker": stock.get("symbol"),
    #                     "company": stock.get("name"),
    #                     "price": stock.get("price"),
    #                     "change": stock.get("change"),
    #                     "change_percent": stock.get("changesPercentage"),
    #                     "volume": stock.get("volume"),
    #                 }
    #             )

    #         return {
    #             "success": True,
    #             "watchlist_type": "trending",
    #             "data": stocks,
    #             "count": len(stocks),
    #             "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
    #         }

    #     except Exception as e:
    #         logger.error(f"Failed to fetch trending stocks: {str(e)}")
    #         return {"success": False, "error": str(e)}

    # def get_insider_buying(self, limit: int = 20) -> Dict:
    #     """
    #     Get stocks with recent insider buying activity.

    #     Args:
    #         limit: Number of stocks to return

    #     Returns:
    #         Dict with success status and list of insider buying transactions
    #     """
    #     try:
    #         # FMP insider trading endpoint
    #         url = f"{self.fmp_base_url_v4}/insider-trading"
    #         params = {
    #             "apikey": self.fmp_api_key,
    #             "transactionType": "P-Purchase",  # Only purchases
    #             "limit": limit * 2,  # Get more to filter
    #         }

    #         response = requests.get(url, params=params, timeout=30)
    #         response.raise_for_status()
    #         data = response.json()

    #         # Group by ticker and aggregate
    #         ticker_map = {}
    #         for transaction in data:
    #             ticker = transaction.get("symbol")
    #             if ticker not in ticker_map:
    #                 ticker_map[ticker] = {
    #                     "ticker": ticker,
    #                     "company": transaction.get("companyName"),
    #                     "total_shares": 0,
    #                     "total_value": 0,
    #                     "transaction_count": 0,
    #                     "latest_date": transaction.get("transactionDate"),
    #                     "insiders": [],
    #                 }

    #             ticker_map[ticker]["total_shares"] += transaction.get(
    #                 "securitiesTransacted", 0
    #             )
    #             ticker_map[ticker]["total_value"] += transaction.get(
    #                 "securitiesTransacted", 0
    #             ) * transaction.get("price", 0)
    #             ticker_map[ticker]["transaction_count"] += 1
    #             ticker_map[ticker]["insiders"].append(
    #                 {
    #                     "name": transaction.get("reportingName"),
    #                     "title": transaction.get("typeOfOwner"),
    #                     "shares": transaction.get("securitiesTransacted"),
    #                     "date": transaction.get("transactionDate"),
    #                 }
    #             )

    #         # Convert to list and sort by total value
    #         stocks = sorted(
    #             ticker_map.values(), key=lambda x: x["total_value"], reverse=True
    #         )[:limit]

    #         return {
    #             "success": True,
    #             "watchlist_type": "insider_buying",
    #             "data": stocks,
    #             "count": len(stocks),
    #             "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
    #         }

    #     except Exception as e:
    #         logger.error(f"Failed to fetch insider buying: {str(e)}")
    #         return {"success": False, "error": str(e)}

    # def get_congress_trading(self, limit: int = 20) -> Dict:
    #     """
    #     Get recent congressional stock trading activity.

    #     Args:
    #         limit: Number of transactions to return

    #     Returns:
    #         Dict with success status and list of congressional trades
    #     """
    #     try:
    #         # FMP senate trading endpoint
    #         url = f"{self.fmp_base_url_v4}/senate-trading"
    #         params = {"apikey": self.fmp_api_key, "limit": limit}

    #         response = requests.get(url, params=params, timeout=30)
    #         response.raise_for_status()
    #         data = response.json()

    #         trades = []
    #         for trade in data:
    #             trades.append(
    #                 {
    #                     "ticker": trade.get("symbol"),
    #                     "politician": trade.get("firstName")
    #                     + " "
    #                     + trade.get("lastName"),
    #                     "transaction_type": trade.get("type"),
    #                     "transaction_date": trade.get("transactionDate"),
    #                     "amount_range": trade.get("amount"),
    #                     "disclosure_date": trade.get("disclosureDate"),
    #                     "asset_description": trade.get("assetDescription"),
    #                 }
    #             )

    #         return {
    #             "success": True,
    #             "watchlist_type": "congress_trading",
    #             "data": trades,
    #             "count": len(trades),
    #             "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
    #         }

    #     except Exception as e:
    #         logger.error(f"Failed to fetch congress trading: {str(e)}")
    #         return {"success": False, "error": str(e)}

    # def get_top_gainers(self, limit: int = 20) -> Dict:
    #     """Get top gaining stocks today."""
    #     try:
    #         url = f"{self.fmp_base_url}/stock_market/gainers"
    #         params = {"apikey": self.fmp_api_key}

    #         response = requests.get(url, params=params, timeout=30)
    #         response.raise_for_status()
    #         data = response.json()

    #         stocks = []
    #         for stock in data[:limit]:
    #             stocks.append(
    #                 {
    #                     "ticker": stock.get("symbol"),
    #                     "company": stock.get("name"),
    #                     "price": stock.get("price"),
    #                     "change": stock.get("change"),
    #                     "change_percent": stock.get("changesPercentage"),
    #                 }
    #             )

    #         return {
    #             "success": True,
    #             "watchlist_type": "top_gainers",
    #             "data": stocks,
    #             "count": len(stocks),
    #             "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
    #         }

    #     except Exception as e:
    #         logger.error(f"Failed to fetch top gainers: {str(e)}")
    #         return {"success": False, "error": str(e)}

    # def get_top_losers(self, limit: int = 20) -> Dict:
    #     """Get top losing stocks today."""
    #     try:
    #         url = f"{self.fmp_base_url}/stock_market/losers"
    #         params = {"apikey": self.fmp_api_key}

    #         response = requests.get(url, params=params, timeout=30)
    #         response.raise_for_status()
    #         data = response.json()

    #         stocks = []
    #         for stock in data[:limit]:
    #             stocks.append(
    #                 {
    #                     "ticker": stock.get("symbol"),
    #                     "company": stock.get("name"),
    #                     "price": stock.get("price"),
    #                     "change": stock.get("change"),
    #                     "change_percent": stock.get("changesPercentage"),
    #                 }
    #             )

    #         return {
    #             "success": True,
    #             "watchlist_type": "top_losers",
    #             "data": stocks,
    #             "count": len(stocks),
    #             "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
    #         }

    #     except Exception as e:
    #         logger.error(f"Failed to fetch top losers: {str(e)}")
    #         return {"success": False, "error": str(e)}


# Singleton instance
_watchlist_service = None


def get_watchlist_service() -> WatchlistService:
    """Get or create the singleton watchlist service instance."""
    global _watchlist_service
    if _watchlist_service is None:
        _watchlist_service = WatchlistService()
    return _watchlist_service
