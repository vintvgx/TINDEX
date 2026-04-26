import time
import re
import asyncio
import json
from typing import Optional, Dict, Any
from dataclasses import dataclass, asdict
from datetime import datetime
import threading

from bs4 import BeautifulSoup

from flask import Flask, jsonify, request # pylint: disable=import-error # type: ignore

import requests
import aiohttp
from log.logging_config import get_logger
from utils.cache import TrendingStocksCache

# Services 
from services.anthropic.anthropic_service import anthropic_service
from services.yfinance.yahoo_watchlist_service import get_yahoo_watchlist_service
from services.supabase.supabase_service import get_supabase_service
from services.utils.research_service import get_research_service
from services.utils.blog_generation_service import get_blog_service
from services.tindex.orb_service import OrbService
from services.alpaca.alpaca_streaming_service import AlpacaStreamingService
from services.tradier.tradier_streaming_service import TradierStreamingService
from services.portfolio.portfolio_service import (
    batch_fetch_current_prices,
    calculate_position_pnl,
)

# Global variables
ORB_SERVICE = None
ORB_TASK = None

"""
Thread safe locking used when initializing global variables to 
ensure multiple instances are not made
"""
orb_lock = threading.Lock()


# Logger for the backend service
logger = get_logger(__name__)

# Creates a flask application
app = Flask(__name__)

# Initialize the cache instance
trending_cache = TrendingStocksCache()
TRENDING_STOCKS_CACHE_TTL = 90  # 90 seconds


# Add request logging middleware
@app.before_request
def log_request_info():
    """
    Log request
    """
    logger.info(
        "Request: %s %s - User-Agent: %s",
        request.method,
        request.path,
        request.headers.get('User-Agent', 'Unknown')
    )


@app.after_request
def log_response_info(response):
    """
    Log response
    """
    logger.info("Response: %s for %s %s", response.status_code, request.method, request.path)
    return response


@dataclass
class RequestData:
    """
    Data class for request to api.

    This class provides a structured way to handle request data across all endpoints.
    It includes validation and type safety for request parameters.

    Example usage:
        # Client-side request
        request_data = {
            "topic": "AAPL",
            "userId": "user123",
            "save_to_db": True,
            "use_cache": True,
            "research_data": {...},
            "target_length": 800,
            "ticker": "AAPL"
        }

        # Server-side validation
        request_data, error = validate_and_create_request_data(request_data)
        if error:
            return jsonify(error), 400

        # Use the validated data
        topic = request_data.topic
        user_id = request_data.userId
    """

    topic: str
    userId: Optional[str]
    save_to_db: Optional[bool] = True
    use_cache: Optional[bool] = True
    research_data: Optional[dict] = None
    target_length: Optional[int] = 800
    ticker: Optional[str] = None
    include_options: Optional[bool] = True
    
    
@dataclass
class RequestDataError:
    """
    Data class for error within request to api.
    """
    success: bool
    error: str
    
    
@app.route("/ticker/<ticker>", methods=["POST"])
def get_ticker_data(ticker: str):
    """
    Retrieves stock ticker data using ticker from URL path.

    This endpoint performs comprehensive research on a given stock ticker,
    gathering financial data, market information, and sentiment analysis.
    
    TODO remove when additional functionalities are added 
    IMPORTANT: This endpoint ONLY performs research. It does not generate blog posts.
    Use /generate_post endpoint to generate blog content from research data.

    URL Parameters:
        ticker (str): The stock ticker symbol (e.g., 'AAPL', 'TSLA')
        
    NOTE: Syntax for using multiple parameters.
        @app.route("/v1/ticker/<ticker>/data/<date>")
        def get_ticker_data(ticker: str, date: str):

    Request Body:
        userId (str): The id of the user requesting the data
        save_to_db (bool, optional): Whether to save results to database (default: True)
        use_cache (bool, optional): Whether to use cached data (default: True)

    Returns:
        JSON response containing research results and database save status
        
    Example Response:
        {
            "success": True,
            "data": {
                "ticker": "AAPL",
                "company_name": "Apple Inc.",
                "current_price": 175.50,
                ...
            },
            "research_id": "uuid-here",
            "cached": False,
            
    """
    try:
        # Validate ticker from URL path
        ticker = ticker.strip().upper()
        
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({
                "success": False,
                "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."
            }), 400
            
        # Get request data
        data = request.get_json()

        # Get supabase service instance
        service = get_supabase_service()
        
        # Get research service instance
        research_service = get_research_service()

        # Validate and create RequestData instance
        request_data, error_response = validate_and_create_ticker_request_data(
            data or {}, ticker=ticker
        )
        if error_response:
            return jsonify(asdict(error_response)), 400

        # Log the request data
        log_request_data(request_data, "get_ticker_data")
        if request_data is not None:
             # Extract values from RequestData
            user_id = request_data.userId
            save_to_db = request_data.save_to_db
            use_cache = request_data.use_cache
            include_options = request_data.include_options


            # Verify the user exists / throw error if user id is not found
            service.verify_user(user_id=user_id)

            # Get research data using the service layer
            research_result = research_service.get_research_data(
                ticker=ticker,
                use_cache=use_cache,
                save_to_db=save_to_db,
                include_options=include_options
            )

            if not research_result["success"]:
                return jsonify(research_result), 400

        return jsonify(research_result)

    except Exception as e:
        logger.error("Ticker research failed for ticker '%s': %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": f"Research failed: {str(e)}"}), 500
    
@app.route("/search/<ticker>", methods=["POST"])
def search_for_ticker(ticker: str):
    """
    Retrieves a ticker and returns basic information (name, current price, logo etc) to be displayed within search bar.
    
    URL Parameters:
+        ticker (str): The stock ticker symbol to search for

    Returns:
        JSON response containing search results  
    """
    try:
        # Validate ticker and process ticker only if it follows the format
        ticker = ticker.strip().upper()
        
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Ticker does not match format"}), 404
        
        # Get research service instance
        research_service = get_research_service()
        
        search_result = research_service.get_ticker_search(ticker)
        
        return jsonify(search_result)

    except Exception as e:
        logger.error("Ticker research failed for ticker '%s': %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "data" : None, "error": f"Ticker not found: {str(e)}"}), 404
        
@app.route("/generate_post/<ticker>", methods=["POST"])
def generate_post(ticker: str):
    """
    Generates a blog post based on research data for a stock ticker.
    
    This endpoint generates a blog post using either:
    1. Cached research data (if available and recent)
    2. Fresh research data from yFinance
    3. Provided research data (if included in request)
    
    The endpoint separates concerns:
    - Research data acquisition (uses research service)
    - Blog content generation (uses blog generation service)
    
    Request Body:
        userId (str): The id of the user requesting the data
        topic (str): The stock ticker to generate blog post about
        research_data (dict, optional): Pre-fetched research data to use
        use_cache (bool, optional): Whether to use cached research data (default: True)
        save_to_db (bool, optional): Whether to save blog post to database (default: True)
        target_length (int, optional): Target word count for blog post (default: 800)

    Returns:
        JSON response containing blog post content and metadata
        
    Example Response:
        {
            "success": True,
            "data": {
                "title": "Apple Inc.: Market Analysis",
                "content": "...",
                "ticker": "AAPL",
                "stock_research_id": "research-uuid"
            },
            "blog_id": "blog-uuid",
            "research_cached": False,
            "timestamp": 1234567890
        }
    """
    try:
        # Validate ticker from URL path
        ticker = ticker.strip().upper()
        
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({
                "success": False,
                "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."
            }), 400
            
        # Get request data
        data = request.get_json()

        # Get supabase service instance
        service = get_supabase_service()
        
        # Get service instances
        research_service = get_research_service()
        blog_service = get_blog_service()

         # Validate and create RequestData instance
        request_data, error_response = validate_and_create_ticker_request_data(
            data or {}, ticker=ticker
        )
        if error_response:
            return jsonify(asdict(error_response)), 400

        # Log the request data
        log_request_data(request_data, "generate_post")

        # Extract values from RequestData
        assert request_data is not None 
        # topic = request_data.topic TODO remove
        user_id = request_data.userId
        save_to_db = request_data.save_to_db
        use_cache = request_data.use_cache
        target_length = request_data.target_length or 800
        provided_research_data = request_data.research_data

        # Verify the user exists
        service.verify_user(user_id=user_id)

        # Step 1: Get research data (use provided data, cache, or fetch fresh)
        research_result = None
        research_data = None
        research_id = None
        used_cache = False
        
        if provided_research_data:
            # Use provided research data
            research_data = provided_research_data
            logger.info("Using provided research data for %s", ticker)
        else:
            # Get research data using the service layer
            research_result = research_service.get_research_data(
                ticker=ticker,
                use_cache=use_cache,
                save_to_db=save_to_db  # Save research if generating blog
            )
            
            if not research_result["success"]:
                return jsonify(research_result), 400
            
            research_data = research_result["data"]
            research_id = research_result.get("research_id")
            used_cache = research_result.get("cached", False)

        # Step 2: Generate blog post using the blog service
        blog_result = blog_service.generate_blog_post(
            ticker=ticker,
            research_data=research_data,
            save_to_db=save_to_db,
            research_id=research_id,
            target_length=target_length,
        )

        if not blog_result["success"]:
            return jsonify(blog_result), 400

        # Prepare response
        response = {
            "success": True,
            "data": blog_result["data"],
            "blog_id": blog_result.get("blog_id"),
            "research_id": research_id,
            "research_cached": used_cache,
            "blog_saved": blog_result.get("saved", False),
            "timestamp": time.time(),
        }

        return jsonify(response)

    except Exception as e:
        # retrieves topic or falls back to unknown
        _topic = locals().get("topic") or (locals().get("data") or {}).get("topic") or "<unknown>"
        logger.error("Blog generation failed for topic '%s': %s", _topic, e, exc_info=True)
        return jsonify({"success": False, "error": f"Blog generation failed: {str(e)}"}), 500


def run_async(coro):
    """Execute an async coroutine in a sync context."""
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()

def validate_and_create_ticker_request_data(
    data: dict, ticker: str, require_user_id: bool = True
) -> tuple[RequestData | None, RequestDataError | None]:
    """
    Validate request data and create a RequestData instance for ticker endpoint.

    Args:
        data: Raw request data from Flask request
        ticker: Ticker symbol from URL path
        require_user_id: Whether userId is required (default: True)

    Returns:
        Tuple of (RequestData instance, error_response_dict)
        If validation fails, RequestData will be None and error_response will contain the error
    """
    try:
        request_data = RequestData(
            topic=ticker, 
            userId=data.get("userId"),
            save_to_db=data.get("save_to_db", True),
            use_cache=data.get("use_cache", True),
            research_data=data.get("research_data", {}),
            target_length=data.get("target_length", 800),
            ticker=ticker,
        )

        # Validate required fields
        if require_user_id and not request_data.userId:
            return None, RequestDataError(
                success=False,
                error="User ID must be a non-empty string"
            )

        return request_data, None

    except Exception as e:
        return None, RequestDataError(
            success=False,
            error=f"Invalid request data: {str(e)}"
        )

def request_data_to_dict(request_data: RequestData) -> dict:
    """
    Convert RequestData instance to dictionary for logging or serialization.

    Args:
        request_data: RequestData instance

    Returns:
        Dictionary representation of RequestData
    """
    return asdict(request_data)

def log_request_data(request_data: RequestData | None, endpoint: str):
    """
    Log RequestData information for debugging and monitoring.

    Args:
        request_data: RequestData instance
        endpoint: The endpoint being called
    """
    if (request_data == None):
        logger.info("Nothing contained in Request")
    else:
        logger.info(
        "Request to %s: topic=%s, "
        "userId=%s, save_to_db=%s, "
        "use_cache=%s",
        endpoint,
        request_data.topic,
        request_data.userId,
        request_data.save_to_db,
        request_data.use_cache
    )

        
@app.route("/generate_ticker_update/<ticker>", methods=["POST"])
def generate_ticker_update(ticker: str):
    """
    Generates a ticker update (tweet-like content) with market analysis tags.

    This endpoint generates a concise, engaging update about a stock ticker based on
    research data. The update is similar to a tweet (270 characters max by default) and
    includes relevant market tags such as "Good for Puts", "Stock to buy", "Volatile", etc.

    Args:
        ticker (str): Stock ticker symbol from URL path

    Request Body (JSON, optional):
        - target_length (int): Maximum character length for the update (default: 270)

    Returns:
        JSON response containing:
            - success (bool): Whether generation succeeded
            - content (str): The generated ticker update text
            - tags (list[str]): List of relevant market tags
            - character_count (int): Actual character count of content
            - ticker (str): The ticker symbol
            - error (str, optional): Error message if failed
    """
    try:
        # Validate ticker from URL path
        ticker = ticker.strip().upper()

        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({
                "success": False,
                "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."
            }), 400

        # Get request data
        request_data = request.get_json() or {}
        target_length = request_data.get("target_length", 500)

        # Validate target_length
        if not isinstance(target_length, int) or target_length < 50 or target_length > 500:
            target_length = 500  # Default to 500 if invalid

        # Get research service instance
        research_service = get_research_service()

        # Get research data using the service layer
        research_result = research_service.get_research_data(
            ticker=ticker,
            use_cache=False, # TODO fix cache logic to ensure cache is not past expiration 
            save_to_db=True
        )

        # Check if research data retrieval was successful
        if not research_result.get("success"):
            return jsonify({
                "success": False,
                "error": research_result.get("error", "Failed to retrieve research data"),
                "ticker": ticker,
            }), 500

        # Extract research data (may be nested in "data" key)
        research_data = research_result

        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                anthropic_service.generate_ticker_update(
                    research_data=research_data,
                    target_length=target_length,
                    ticker=ticker,
                )
            )
        finally:
            loop.close()

        # Check if the result indicates failure
        if not result.get("success", True):
            # Determine appropriate HTTP status code based on error type
            error_details = result.get("error_details", {})
            error_type = error_details.get("type", "unknown_error")
            status_code = error_details.get("status_code", 500)
            
            # Map error types to HTTP status codes
            if error_type == "not_found_error" or status_code == 404:
                http_status = 404
            elif error_type == "connection_error" or error_type == "timeout_error":
                http_status = 503  # Service Unavailable
            elif status_code in [400, 401, 403, 429]:
                http_status = status_code
            else:
                http_status = 500
            
            logger.error(
                "Ticker update generation failed for %s: %s (HTTP %s)",
                ticker,
                result.get("error", "Unknown error"),
                http_status,
            )
            
            return jsonify(result), http_status

        # Step 3: Save ticker update to database if generation was successful
        ticker_update_id = None
        try:
            # Get supabase service instance
            service = get_supabase_service()
            
            # Prepare ticker update data for saving (user_id not included - only for auth)
            # Get stock_research_id with fallback - try research_result first, then research_data, then None
            stock_research_id = None
            if isinstance(research_result, dict) and research_result.get("research_id"):
                stock_research_id = research_result.get("research_id")
            elif isinstance(research_data, dict) and research_data.get("research_id"):
                stock_research_id = research_data.get("research_id")
            elif isinstance(research_data, dict) and research_data.get("id"):
                stock_research_id = research_data.get("id")
            
            ticker_update_data = {
                "ticker": ticker,
                "content": result.get("content", ""),
                "character_count": result.get("character_count", 0),
                "tags": result.get("tags", []),
                "model_used": result.get("model_used", "claude-haiku-4-5"),
                "target_length": target_length,
                "stock_research_id": stock_research_id,
                "status": "published",
            }
            
            # Save to database
            save_result = service.save_ticker_update(ticker_update_data)
            
            if save_result.get("success"):
                ticker_update_id = save_result.get("data", {}).get("id")
                logger.info(f"Ticker update saved successfully for {ticker} (ID: {ticker_update_id})")
            else:
                logger.warning(f"Failed to save ticker update for {ticker}: {save_result.get('error', 'Unknown error')}")
                
        except Exception as save_error:
            # Log error but don't fail the request - generation was successful
            logger.error(f"Error saving ticker update for {ticker}: {str(save_error)}", exc_info=True)

        # Success case - include save status in response
        response = result.copy()
        response["ticker_update_id"] = ticker_update_id
        response["saved"] = ticker_update_id is not None
        
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Ticker update generation failed for {ticker}: {str(e)}", exc_info=True)
        return (
            jsonify({
                "success": False,
                "error": f"Ticker update generation failed: {str(e)}",
                "ticker": ticker,
            }),
            500,
        )


@app.route("/trending-stocks-sort", methods=["GET", "POST"])
def get_trending_stocks_by_param():
    """
    Retrieve trending stocks from FINVIZ screener sorted by specified parameter.

    This endpoint fetches the top 20 stocks from FINVIZ sorted by the specified parameter.

    Request Parameters:
        sort_by (str): Parameter to sort by. Valid options:
            - 'volume': Sort by volume (descending)
            - 'change': Sort by price change (descending)
            - 'pe': Sort by P/E ratio (ascending)
            - 'marketcap': Sort by market cap (descending)

    For GET requests, pass sort_by as query parameter: ?sort_by=volume
    For POST requests, pass sort_by in JSON body: {"sort_by": "volume"}

    Returns:
        JSON response containing trending stocks data with:
        - success (bool): Whether the request was successful
        - sorted_by (str): The parameter used for sorting
        - data (list): Array of stock objects with ticker, company, sector, etc.
        - count (int): Number of stocks returned
        - timestamp (float): Unix timestamp of when data was fetched
    """
    try:
        # Get sort_by parameter from either query params (GET) or JSON body (POST)
        if request.method == "GET":
            sort_by = request.args.get("sort_by")
        else:  # POST
            data = request.get_json() or {}
            sort_by = data.get("sort_by")

        # Validate sort_by parameter
        if not sort_by:
            return (
                jsonify({"success": False, "error": "sort_by parameter is required"}),
                400,
            )

        # Validate sort_by value
        valid_sort_params = ["volume", "change", "pe", "marketcap"]
        if sort_by not in valid_sort_params:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f'Invalid sort_by parameter. Must be one of: {", ".join(valid_sort_params)}',
                    }
                ),
                400,
            )

        # Check cache first
        cache_key = f"trending_stocks_{sort_by}"
        cached_data = trending_cache.get(cache_key)

        if cached_data:
            logger.info("Returning cached trending stocks data for sort_by: %s", sort_by)
            return jsonify({**cached_data, "from_cache": True})

        logger.info("Fetching trending stocks from FINVIZ, sorted by: %s", sort_by)

        # FINVIZ trending stocks URL - sorted by param (descending)
        url = f"https://finviz.com/screener.ashx?v=111&o=-{sort_by}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (HTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }

        response = requests.get(url, headers=headers, timeout=60)
        response.raise_for_status()  # Raise exception for bad status codes

        soup = BeautifulSoup(response.content, "html.parser")

        # Parse the FINVIZ screener table
        stocks = []
        table = soup.find("table", {"class": "screener_table"})

        if table:
            rows = table.find_all("tr")[1:]   # pylint: disable=import-error # type: ignore
            for row in rows[:20]:  # Top 20 stocks
                cells = row.find_all("td")
                if len(cells) >= 11:  # Ensure we have enough columns
                    try:
                        stock_data = {
                            "ticker": cells[1].text.strip(),
                            "company": cells[2].text.strip(),
                            "sector": cells[3].text.strip(),
                            "industry": cells[4].text.strip(),
                            "market_cap": cells[6].text.strip(),
                            "pe": cells[7].text.strip(),
                            "price": cells[8].text.strip(),
                            "change": cells[9].text.strip(),
                            "volume": cells[10].text.strip(),
                        }
                        stocks.append(stock_data)
                    except (IndexError, AttributeError) as e:
                        logger.warning("Error parsing stock row: %s", e)
                        continue
        else:
            logger.warning("Could not find screener table in FINVIZ response")

        logger.info("Successfully fetched %s trending stocks", len(stocks))
        
        # Use epoch milliseconds to align with mobile (JS Date expects ms)
        current_time_ms = int(time.time() * 1000)

        # Create the response payload
        response_data = {
            "success": True,
            "sorted_by": sort_by,
            "data": stocks,
            "count": len(stocks),
            "source": "FINVIZ",
            "timestamp": current_time_ms,
        }
        
        # Cache the response data for future requests
        trending_cache.set(cache_key, response_data, TRENDING_STOCKS_CACHE_TTL)
        logger.info("Cached trending stocks data for sort_by: %s (TTL: %s seconds)", sort_by, TRENDING_STOCKS_CACHE_TTL)

        return jsonify({**response_data, "from_cache": False})

    except requests.RequestException as e:
        logger.error("Request failed when fetching trending stocks: %s", e)
        return (
            jsonify(
                {
                    "success": False,
                    "error": f"Failed to fetch data by {sort_by}, from FINVIZ: {str(e)}",
                }
            ),
            503,
        )
    except Exception as e:
        logger.error("Trending stocks failed: %s", e, exc_info=True)
        return (
            jsonify(
                {
                    "success": False,
                    "code": "UPSTREAM_FETCH_FAILED",
                    "error": "Unable to fetch trending stocks at this time",
                }
            ),
            500,
        )

@app.route("/yahoo/gainers", methods=["GET"])
def get_yahoo_gainers():
    """
    Get biggest gaining stocks from Yahoo Finance (web scraping).
    
    Query Parameters:
        limit (int, optional): Number of stocks to return (default: 25)
        use_cache (bool, optional): Whether to use cached data (default: true)
    
    Returns:
        JSON response with gaining stocks data scraped from Yahoo Finance
        
    Example:
        GET /yahoo/gainers?limit=20
    """
    try:
        limit = request.args.get('limit', default=25, type=int)
        use_cache = request.args.get('use_cache', default='true').lower() == 'true'
        
        # Validate limit
        if limit < 1 or limit > 100:
            return jsonify({
                "success": False,
                "error": "Limit must be between 1 and 100"
            }), 400
        
        # Check cache
        cache_key = f"yahoo_gainers_{limit}"
        if use_cache:
            cached_data = trending_cache.get(cache_key)
            if cached_data:
                logger.info("Returning cached Yahoo gainers data")
                return jsonify({**cached_data, "from_cache": True})
        
        # Fetch fresh data
        service = get_yahoo_watchlist_service()
        result = service.get_gainers(limit=limit)
        
        if not result.get("success"):
            return jsonify(result), 500
        
        # Cache the result
        trending_cache.set(cache_key, result, TRENDING_STOCKS_CACHE_TTL)
        logger.info("Cached Yahoo gainers data")
        
        return jsonify({**result, "from_cache": False})
        
    except Exception as e:
        logger.error("Failed to fetch Yahoo gainers: %s", e, exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to fetch gainers: {str(e)}"
        }), 500

@app.route("/yahoo/trending", methods=["GET"])
def get_yahoo_trending():
    """
    Get trending stocks from Yahoo Finance (web scraping).
    
    Query Parameters:
        limit (int, optional): Number of stocks to return (default: 25)
        use_cache (bool, optional): Whether to use cached data (default: true)
    
    Returns:
        JSON response with trending stocks data scraped from Yahoo Finance
        
    Example:
        GET /yahoo/trending?limit=20
    """
    try:
        limit = request.args.get('limit', default=25, type=int)
        use_cache = request.args.get('use_cache', default='true').lower() == 'true'
        
        # Validate limit
        if limit < 1 or limit > 100:
            return jsonify({
                "success": False,
                "error": "Limit must be between 1 and 100"
            }), 400
        
        # Check cache
        cache_key = f"yahoo_trending_{limit}"
        if use_cache:
            cached_data = trending_cache.get(cache_key)
            if cached_data:
                logger.info("Returning cached Yahoo trending data")
                return jsonify({**cached_data, "from_cache": True})
        
        # Fetch fresh data
        service = get_yahoo_watchlist_service()
        result = service.get_trending(limit=limit)
        
        if not result.get("success"):
            return jsonify(result), 500
        
        # Cache the result
        trending_cache.set(cache_key, result, TRENDING_STOCKS_CACHE_TTL)
        logger.info("Cached Yahoo trending data")
        
        return jsonify({**result, "from_cache": False})
        
    except Exception as e:
        logger.error("Failed to fetch Yahoo trending: %s", e, exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to fetch trending stocks: {str(e)}"
        }), 500

@app.route("/yahoo/most-active", methods=["GET"])
def get_yahoo_most_active():
    """
    Get most active stocks from Yahoo Finance (web scraping).
    
    Query Parameters:
        limit (int, optional): Number of stocks to return (default: 25)
        use_cache (bool, optional): Whether to use cached data (default: true)
    
    Returns:
        JSON response with most active stocks data scraped from Yahoo Finance
        
    Example:
        GET /yahoo/most-active?limit=20
    """
    try:
        limit = request.args.get('limit', default=25, type=int)
        use_cache = request.args.get('use_cache', default='true').lower() == 'true'
        
        # Validate limit
        if limit < 1 or limit > 100:
            return jsonify({
                "success": False,
                "error": "Limit must be between 1 and 100"
            }), 400
        
        # Check cache
        cache_key = f"yahoo_most_active_{limit}"
        if use_cache:
            cached_data = trending_cache.get(cache_key)
            if cached_data:
                logger.info("Returning cached Yahoo most active data")
                return jsonify({**cached_data, "from_cache": True})
        
        # Fetch fresh data
        service = get_yahoo_watchlist_service()
        result = service.get_most_active(limit=limit)
        
        if not result.get("success"):
            return jsonify(result), 500
        
        # Cache the result
        trending_cache.set(cache_key, result, TRENDING_STOCKS_CACHE_TTL)
        logger.info("Cached Yahoo most active data")
        
        return jsonify({**result, "from_cache": False})
        
    except Exception as e:
        logger.error("Failed to fetch Yahoo most active: %s", e, exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to fetch most active stocks: {str(e)}"
        }), 500

@app.route("/watchlist/all", methods=["GET"])
def get_all_yahoo_watchlists():
    """
    Get all Yahoo Finance watchlists in a single request (web scraping).
    
    Query Parameters:
        limit (int, optional): Number of stocks per watchlist (default: 25)
    
    Returns:
        JSON response with all watchlists scraped from Yahoo Finance
        
    Example:
        GET /yahoo/all?limit=20
    """
    try:
        limit = request.args.get('limit', default=25, type=int)
        
        # Validate limit
        if limit < 1 or limit > 100:
            return jsonify({
                "success": False,
                "error": "Limit must be between 1 and 100"
            }), 400
        
        # Fetch all watchlists
        service = get_yahoo_watchlist_service()
        result = service.get_all_watchlists(limit=limit)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error("Failed to fetch all Yahoo watchlists: %s", e, exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to fetch watchlists: {str(e)}"
        }), 500

def get_orb_service(provider: str = "alpaca") -> OrbService:
    """
    Get ORB service with the specified streaming provider.
    
    Args:
        provider: "alpaca" or "tradier" (default: "alpaca")
        
    Returns:
        OrbService instance with the specified streaming service
    """
    if provider.lower() == "tradier":
        streaming_service = TradierStreamingService()
    else:
        streaming_service = AlpacaStreamingService()
    
    return OrbService(streaming_service)


@app.route("/tindex/orb/start", methods=["POST"])
def start_orb_monitoring():
    """Start ORB monitoring - called by Supabase cron at 9:15 AM
    
    Query Parameters:
        debug (optional): Set to 'true' to bypass market hours check for testing
        provider (optional): "alpaca" or "tradier" (default: "alpaca")
    """
    global ORB_SERVICE, ORB_TASK
    
    try:
        # Check for debug mode in query parameters or request body
        debug_mode = request.args.get('debug', '').lower() == 'true'
        provider = request.args.get('provider', 'alpaca').lower()
        
        if not debug_mode:
            # Also check request body for debug flag
            try:
                request_data = request.get_json(silent=True) or {}
                debug_mode = request_data.get('debug', False)
                provider = request_data.get('provider', 'alpaca').lower()
            except Exception as e:
                logger.error("Failed to retrieve request data: %s", e)

        
        with orb_lock:
            if ORB_SERVICE and ORB_SERVICE.is_running:
                return jsonify({"message": "ORB service already running"})
        
        # Get service instance with specified provider
        ORB_SERVICE = get_orb_service(provider=provider)
        
        # Run in background thread
        def run_orb():
            if ORB_SERVICE is not None:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(ORB_SERVICE.start(debug_mode=debug_mode))                
        
        ORB_TASK = threading.Thread(target=run_orb, daemon=True)
        ORB_TASK.start()
        
        message = f"ORB monitoring started with {provider.upper()} streaming"
        if debug_mode:
            message += " (DEBUG MODE: Market hours check bypassed)"
        
        return jsonify({
            "success": True,
            "message": message,
            "debug_mode": debug_mode,
            "provider": provider
        })
        
    except Exception as e:
        logger.error(f"Failed to start ORB monitoring: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/tindex/orb/stop", methods=["POST"])
def stop_orb_monitoring():
    """Stop ORB monitoring - called by Supabase cron at 5:00 PM"""
    global ORB_SERVICE
    
    try:
        with orb_lock:
            if ORB_SERVICE and ORB_SERVICE.is_running:
                asyncio.run(ORB_SERVICE.stop())
                ORB_SERVICE = None
                return jsonify({"success": True, "message": "ORB monitoring stopped"})
        
        return jsonify({"message": "ORB service not running"})
        
    except Exception as e:
        logger.error(f"Failed to stop ORB monitoring: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/tindex/orb/status", methods=["GET"])
def get_orb_status():
    """Check ORB monitoring status"""
    
    with orb_lock:
        # Safely check if service exists and is running
        if (ORB_SERVICE and 
            hasattr(ORB_SERVICE, 'is_running') and 
            ORB_SERVICE.is_running):
            return jsonify({
                "running": True,
                "calculation_phase": getattr(ORB_SERVICE, 'calculation_phase', False),
                "active_tickers": list(getattr(ORB_SERVICE, 'active_tickers', set())),
                "orb_ranges_count": len(getattr(ORB_SERVICE, 'orb_ranges', {}))
            })
        
        return jsonify({"running": False})

@app.route("/options/<ticker>", methods=["GET"])
def get_options(ticker: str):
    """
    Retrieve options data for a ticker.
    
    This endpoint retrieves options data from Tradier API and returns it.
    It does NOT start a stream - it's a one-time request. For real-time
    updates, options streaming will be integrated into the ORB service.
    
    Query Parameters:
        feed (optional): Deprecated - kept for backward compatibility but ignored (Tradier uses consolidated data)
        limit (optional): Maximum contracts to return (default: 25)
        strike_price_gte (optional): Minimum strike price (float)
        strike_price_lte (optional): Maximum strike price (float)
        expiration_date_gte (optional): Minimum expiration date in format 'YYYY-MM-DD' (default: today + 7 days)
        expiration_date_lte (optional): Maximum expiration date in format 'YYYY-MM-DD' (default: today + 14 days)
    
    Returns:
        JSON response containing options data with calls and puts
    
    Example Request:
        GET /options/IWM?limit=25&strike_price_gte=185&strike_price_lte=205&expiration_date_gte=2024-01-22&expiration_date_lte=2024-01-29
    
    Example Response:
        {
            "success": true,
            "data": {
                "ticker": "IWM",
                "current_price": 195.50,
                "calls": [...],
                "puts": [...],
                "last_updated": "2024-01-15T10:30:00Z",
                "source": "tradier"
            },
            "timestamp": 1705323000
        }
    """
    try:
        # Validate ticker from URL path
        ticker = ticker.strip().upper()
        
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({
                "success": False,
                "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters.",
                "ticker": ticker
            }), 400
        
        # Get query parameters
        feed = request.args.get('feed', 'indicative')  # Deprecated but kept for backward compatibility
        limit = request.args.get('limit', 100, type=int)
        strike_price_gte = request.args.get('strike_price_gte', type=float)
        strike_price_lte = request.args.get('strike_price_lte', type=float)
        expiration_date_gte = request.args.get('expiration_date_gte')
        expiration_date_lte = request.args.get('expiration_date_lte')

        # Note: feed parameter is ignored when using Tradier (they provide consolidated exchange data)
        # Keeping validation for backward compatibility but it won't affect the request
        if feed and feed not in ['indicative', 'opra']:
            logger.warning(f"Invalid feed parameter '{feed}' for ticker {ticker} - ignored (Tradier uses consolidated data)")

        # Validate limit
        if limit < 1 or limit > 500:
            return jsonify({
                "success": False,
                "error": "Limit must be between 1 and 500",
                "ticker": ticker
            }), 400
        
        # Validate date formats if provided
        if expiration_date_gte:
            try:
                datetime.strptime(expiration_date_gte, '%Y-%m-%d')
            except ValueError:
                return jsonify({
                    "success": False,
                    "error": "Invalid expiration_date_gte format. Must be 'YYYY-MM-DD'",
                    "ticker": ticker
                }), 400
        
        if expiration_date_lte:
            try:
                datetime.strptime(expiration_date_lte, '%Y-%m-%d')
            except ValueError:
                return jsonify({
                    "success": False,
                    "error": "Invalid expiration_date_lte format. Must be 'YYYY-MM-DD'",
                    "ticker": ticker
                }), 400
        
        # Get Tradier options service
        from services.tradier.tradier_option_service import get_tradier_option_service
        options_service = get_tradier_option_service()
        
        # Fetch options (async call wrapped for Flask)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                options_service.get_options(
                    ticker=ticker,
                    limit=limit,
                    strike_price_gte=strike_price_gte,
                    strike_price_lte=strike_price_lte,
                    expiration_date_gte=expiration_date_gte,
                    expiration_date_lte=expiration_date_lte,
                    include_greeks=True
                )
            )
        finally:
            loop.close()
        
        return jsonify({
            "success": True,
            "data": result,
            "timestamp": time.time()
        })
        
    except ValueError as e:
        logger.error(f"Validation error for options request {ticker}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": str(e),
            "ticker": ticker
        }), 400
    except Exception as e:
        # Handle Tradier SDK errors
        error_type = type(e).__name__
        if "API" in error_type or "client" in error_type.lower() or "tradier" in error_type.lower():
            logger.error(f"Tradier SDK error for options {ticker}: {e}", exc_info=True)
            return jsonify({
                "success": False,
                "error": f"Failed to fetch options data: {str(e)}",
                "ticker": ticker
            }), 503
        logger.error(f"Options retrieval failed for {ticker}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Options retrieval failed: {str(e)}",
            "ticker": ticker
        }), 500


@app.route("/track-option", methods=["POST"])
def track_option():
    """
    Track an options contract for a user.
    
    Request Body (JSON):
        userId (str): The ID of the user tracking the contract
        ticker (str): Stock ticker symbol
        contractSymbol (str): Contract symbol (e.g., "AAPL231215C00150000")
        optionType (str): "CALL" or "PUT"
        strike (float): Strike price
        expirationDate (str): Expiration date (ISO format: "YYYY-MM-DD")
        trackingSnapshot (dict): Full OptionsOpportunity object
        trackedFromSource (str, optional): "orb_breakout", "manual", or "followed_stock"
        orbBreakoutId (str, optional): Link to orb_monitoring_state if applicable
        initialAnalysisScore (float, optional): Score from OptionsAnalyzer
        trackingReason (str, optional): User's reason for tracking
    
    Returns:
        JSON response containing success status and tracked contract data
    
    Example Request:
        POST /track-option
        {
            "userId": "user123",
            "ticker": "AAPL",
            "contractSymbol": "AAPL231215C00150000",
            "optionType": "CALL",
            "strike": 150.00,
            "expirationDate": "2024-12-15",
            "trackingSnapshot": {...},
            "trackedFromSource": "orb_breakout",
            "initialAnalysisScore": 85.5
        }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                "success": False,
                "error": "Request body is required"
            }), 400
        
        # Validate required fields
        user_id = data.get("userId")
        if not user_id:
            return jsonify({
                "success": False,
                "error": "userId is required"
            }), 400
        
        ticker = data.get("ticker", "").strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({
                "success": False,
                "error": "Invalid ticker symbol format"
            }), 400
        
        # Get supabase service
        service = get_supabase_service()
        
        # Verify user
        service.verify_user(user_id=user_id)
        
        # Prepare contract data
        contract_data = {
            'ticker': ticker,
            'contract_symbol': data.get('contractSymbol', ''),
            'option_type': data.get('optionType', '').upper(),
            'strike': data.get('strike'),
            'expiration_date': data.get('expirationDate'),
            'tracking_snapshot': data.get('trackingSnapshot', {}),
            'tracked_from_source': data.get('trackedFromSource', 'manual'),
            'orb_breakout_id': data.get('orbBreakoutId'),
            'initial_analysis_score': data.get('initialAnalysisScore'),
            'tracking_reason': data.get('trackingReason'),
        }
        
        # Track contract
        result = service.track_option_contract(user_id, contract_data)
        
        if result.get("success"):
            return jsonify(result), 200
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Failed to track option contract: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to track contract: {str(e)}"
        }), 500


@app.route("/tracked-options", methods=["GET"])
def get_tracked_options():
    """
    Get tracked contracts for a user.
    
    Query Parameters:
        userId (str, required): The ID of the user
        status (str, optional): Filter by status ("tracking", "entered", "exited", "expired", "cancelled")
    
    Returns:
        JSON response containing list of tracked contracts
    
    Example Request:
        GET /tracked-options?userId=user123&status=tracking
    """
    try:
        user_id = request.args.get("userId")
        status_filter = request.args.get("status")
        
        if not user_id:
            return jsonify({
                "success": False,
                "error": "userId query parameter is required"
            }), 400
        
        # Get supabase service
        service = get_supabase_service()
        
        # Verify user
        service.verify_user(user_id=user_id)
        
        # Get tracked contracts
        result = service.get_tracked_contracts(user_id, status_filter)
        
        return jsonify(result), 200
            
    except Exception as e:
        logger.error(f"Failed to get tracked options: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to get tracked contracts: {str(e)}"
        }), 500


@app.route("/track-option/<contract_id>", methods=["PUT"])
def update_tracked_option(contract_id: str):
    """
    Update the status of a tracked contract.
    
    URL Parameters:
        contract_id (str): The ID of the contract
    
    Request Body (JSON):
        userId (str): The ID of the user
        status (str): New status ("entered", "exited", "cancelled")
        entryPrice (float, optional): Entry price (required for "entered")
        exitPrice (float, optional): Exit price (required for "exited")
        positionSize (int, optional): Position size
    
    Returns:
        JSON response containing updated contract data
    
    Example Request:
        PUT /track-option/contract-uuid-here
        {
            "userId": "user123",
            "status": "entered",
            "entryPrice": 2.50,
            "positionSize": 10
        }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                "success": False,
                "error": "Request body is required"
            }), 400
        
        user_id = data.get("userId")
        if not user_id:
            return jsonify({
                "success": False,
                "error": "userId is required"
            }), 400
        
        status = data.get("status")
        if status not in ["entered", "exited", "cancelled"]:
            return jsonify({
                "success": False,
                "error": "status must be 'entered', 'exited', or 'cancelled'"
            }), 400
        
        # Get supabase service
        service = get_supabase_service()
        
        # Verify user
        service.verify_user(user_id=user_id)
        
        # Update contract status
        result = service.update_contract_status(
            user_id=user_id,
            contract_id=contract_id,
            status=status,
            entry_price=data.get("entryPrice"),
            exit_price=data.get("exitPrice"),
            position_size=data.get("positionSize")
        )
        
        if result.get("success"):
            return jsonify(result), 200
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Failed to update tracked option: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to update contract: {str(e)}"
        }), 500


@app.route("/track-option/<contract_id>", methods=["DELETE"])
def delete_tracked_option(contract_id: str):
    """
    Delete (untrack) an options contract for a user.
    
    URL Parameters:
        contract_id (str): The ID of the contract
    
    Query Parameters:
        userId (str, required): The ID of the user
    
    Returns:
        JSON response containing success status
    
    Example Request:
        DELETE /track-option/contract-uuid-here?userId=user123
    """
    try:
        user_id = request.args.get("userId")
        
        if not user_id:
            return jsonify({
                "success": False,
                "error": "userId query parameter is required"
            }), 400
        
        # Get supabase service
        service = get_supabase_service()
        
        # Verify user
        service.verify_user(user_id=user_id)
        
        # Delete contract
        result = service.delete_tracked_contract(user_id=user_id, contract_id=contract_id)
        
        if result.get("success"):
            return jsonify(result), 200
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Failed to delete tracked option: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to delete contract: {str(e)}"
        }), 500


@app.route("/suggested-contracts/<ticker>", methods=["GET"])
def get_suggested_contracts(ticker: str):
    """
    Get top 3 suggested contracts for a ticker after ORB breakout.
    
    Uses OptionsAnalyzer to score and prioritize contracts.
    
    URL Parameters:
        ticker (str): Stock ticker symbol
    
    Query Parameters:
        limit (int, optional): Number of contracts to return (default: 5, max: 10)
    
    Returns:
        JSON response containing top suggested contracts
    
    Example Request:
        GET /suggested-contracts/AAPL?limit=3
    
    Example Response:
        {
            "success": true,
            "data": {
                "ticker": "AAPL",
                "contracts": [...],  // Top 5 OptionsOpportunity objects
                "count": 5
            },
            "timestamp": 1705323000
        }
    """
    try:
        # Validate ticker
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({
                "success": False,
                "error": "Invalid ticker symbol format"
            }), 400
        
        limit = request.args.get("limit", 5, type=int)
        limit = min(max(limit, 1), 10)  # Clamp between 1 and 10
        
        # Get research service
        research_service = get_research_service()
        
        # Get ticker data with options
        research_result = research_service.get_research_data(
            ticker=ticker,
            use_cache=True,
            save_to_db=False,
            include_options=True
        )
        
        if not research_result.get("success"):
            return jsonify({
                "success": False,
                "error": "Failed to fetch ticker data",
                "details": research_result.get("error")
            }), 400
        
        research_data = research_result.get("data", {})
        options_analysis = research_data.get("options_analysis", {})
        
        if not options_analysis or not options_analysis.get("has_opportunities"):
            return jsonify({
                "success": False,
                "error": f"No options opportunities available for {ticker}",
                "data": {
                    "ticker": ticker,
                    "contracts": [],
                    "count": 0
                }
            }), 404
        
        opportunities = options_analysis.get("opportunities", [])
        
        # Sort by total_score (highest first) and take top N
        sorted_opportunities = sorted(
            opportunities,
            key=lambda x: x.get("total_score", 0),
            reverse=True
        )[:limit]
        
        return jsonify({
            "success": True,
            "data": {
                "ticker": ticker,
                "contracts": sorted_opportunities,
                "count": len(sorted_opportunities)
            },
            "timestamp": time.time()
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to get suggested contracts for {ticker}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to get suggested contracts: {str(e)}",
            "ticker": ticker
        }), 500


@app.route("/portfolio/refresh-prices", methods=["POST"])
def refresh_portfolio_prices():
    """
    Fetch current prices for all open positions, compute unrealized P&L,
    and update the portfolio summary table.

    Request Body:
        userId (str): The authenticated user's ID

    Returns:
        JSON with success, positions (enriched with current_price, unrealized_pnl, etc.),
        and summary (total_cost_basis, total_current_value, total_unrealized_pnl, performance_pct).
        If no open positions, returns positions=[], summary=None.
    """
    try:
        data = request.get_json() or {}
        user_id = data.get("userId")

        if not user_id:
            return jsonify({"success": False, "error": "userId required"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        result = (
            service.client.table("portfolio_positions")
            .select("id, ticker, shares, average_cost, position_type")
            .eq("user_id", user_id)
            .eq("status", "open")
            .execute()
        )

        positions = result.data or []
        if not positions:
            return jsonify({"success": True, "positions": [], "summary": None})

        tickers = list({p["ticker"] for p in positions})
        prices = batch_fetch_current_prices(tickers)

        if not prices:
            return (
                jsonify({"success": False, "error": "Could not fetch market prices"}),
                502,
            )

        enriched_positions = []
        total_cost_basis = 0.0
        total_current_value = 0.0
        total_unrealized = 0.0

        for pos in positions:
            ticker = pos["ticker"]
            current_price = prices.get(ticker)

            if current_price is None:
                enriched_positions.append({
                    **pos,
                    "current_price": None,
                    "unrealized_pnl": None,
                    "current_value": None,
                    "cost_basis": None,
                    "pnl_pct": None,
                })
                continue

            pnl = calculate_position_pnl(
                shares=float(pos["shares"]),
                avg_cost=float(pos["average_cost"]),
                current_price=current_price,
                position_type=pos.get("position_type") or "long",
            )

            total_cost_basis += pnl["cost_basis"]
            total_current_value += pnl["current_value"]
            total_unrealized += pnl["unrealized_pnl"]

            enriched_positions.append({**pos, **pnl})

        performance_pct = (
            (total_current_value - total_cost_basis) / total_cost_basis * 100
            if total_cost_basis > 0
            else 0.0
        )

        positions_with_price = len([p for p in enriched_positions if p.get("current_price") is not None])
        service.client.table("portfolio").upsert(
            {
                "user_id": user_id,
                "total_cost_basis": round(total_cost_basis, 4),
                "total_current_value": round(total_current_value, 4),
                "total_unrealized_pnl": round(total_unrealized, 4),
                "performance_pct": round(performance_pct, 4),
                "positions_count": positions_with_price,
            },
            on_conflict="user_id",
        ).execute()

        return jsonify({
            "success": True,
            "positions": enriched_positions,
            "summary": {
                "total_cost_basis": round(total_cost_basis, 4),
                "total_current_value": round(total_current_value, 4),
                "total_unrealized_pnl": round(total_unrealized, 4),
                "performance_pct": round(performance_pct, 4),
            },
        })

    except Exception as e:
        logger.error("Portfolio refresh failed: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/portfolio-metrics", methods=["GET"])
def get_portfolio_metrics():
    """
    Get aggregate portfolio metrics for a user.
    
    Query Parameters:
        userId (str, required): The ID of the user
    
    Returns:
        JSON response containing portfolio metrics:
        - totalContracts: Total number of tracked contracts
        - activeContracts: Number of active contracts (tracking or entered)
        - totalUnrealizedPnL: Total unrealized P&L (if contracts are entered)
        - totalUnrealizedPnLPercent: Percentage P&L
        - totalCostBasis: Total cost basis
        - totalCurrentValue: Total current value
        - riskExposure: Array of exposure by ticker
    
    Example Request:
        GET /portfolio-metrics?userId=user123
    """
    try:
        user_id = request.args.get("userId")
        
        if not user_id:
            return jsonify({
                "success": False,
                "error": "userId query parameter is required"
            }), 400
        
        # Get supabase service
        service = get_supabase_service()
        
        # Verify user
        service.verify_user(user_id=user_id)
        
        # Get all tracked contracts
        result = service.get_tracked_contracts(user_id, status_filter=None)
        
        if not result.get("success"):
            return jsonify(result), 400
        
        contracts = result.get("data", [])
        
        # Calculate metrics
        total_contracts = len(contracts)
        active_contracts = len([c for c in contracts if c.get("status") in ["tracking", "entered"]])
        
        # Calculate PnL for entered contracts
        entered_contracts = [c for c in contracts if c.get("status") == "entered"]
        total_cost_basis = sum(
            (c.get("entry_price") or 0) * (c.get("position_size") or 1)
            for c in entered_contracts
        )
        
        # TODO: Calculate current value from market prices (Phase 2)
        # For now, use entry price as placeholder
        total_current_value = total_cost_basis
        total_unrealized_pnl = 0
        total_unrealized_pnl_percent = 0
        
        # Calculate risk exposure by ticker
        ticker_exposure = {}
        for contract in contracts:
            ticker = contract.get("ticker", "")
            if not ticker:
                continue
            
            if ticker not in ticker_exposure:
                ticker_exposure[ticker] = {
                    "ticker": ticker,
                    "contractCount": 0,
                    "totalCostBasis": 0,
                    "unrealizedPnL": 0,
                    "unrealizedPnLPercent": 0,
                }
            
            ticker_exposure[ticker]["contractCount"] += 1
            
            if contract.get("status") == "entered":
                cost_basis = (contract.get("entry_price") or 0) * (contract.get("position_size") or 1)
                ticker_exposure[ticker]["totalCostBasis"] += cost_basis
        
        # Calculate exposure percentages
        risk_exposure = list(ticker_exposure.values())
        if total_cost_basis > 0:
            for exposure in risk_exposure:
                exposure["exposurePercent"] = (exposure["totalCostBasis"] / total_cost_basis) * 100
        else:
            for exposure in risk_exposure:
                exposure["exposurePercent"] = 0
        
        # Sort by exposure (highest first)
        risk_exposure.sort(key=lambda x: x["totalCostBasis"], reverse=True)
        
        metrics = {
            "totalContracts": total_contracts,
            "activeContracts": active_contracts,
            "totalUnrealizedPnL": total_unrealized_pnl,
            "totalUnrealizedPnLPercent": total_unrealized_pnl_percent,
            "totalCostBasis": total_cost_basis,
            "totalCurrentValue": total_current_value,
            "riskExposure": risk_exposure,
        }
        
        return jsonify({
            "success": True,
            "data": metrics,
            "timestamp": time.time()
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to get portfolio metrics: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"Failed to get portfolio metrics: {str(e)}"
        }), 500


if __name__ == "__main__":
    app.run(debug=True)
