import time
import re
import asyncio
import json
from typing import Optional, Dict, Any
from dataclasses import dataclass, asdict
import threading

from bs4 import BeautifulSoup

from flask import Flask, jsonify, request # pylint: disable=import-error # type: ignore

import requests
from log.logging_config import get_logger
from utils.cache import TrendingStocksCache

# Services 
from services.anthropic_service import anthropic_service
from services.yahoo_watchlist_service import get_yahoo_watchlist_service
from services.supabase_service import get_supabase_service
from services.research_service import get_research_service
from services.blog_generation_service import get_blog_service
from services.alpaca_service import get_alpaca_service

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
        if not isinstance(target_length, int) or target_length < 50 or target_length > 750:
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
            if isinstance(research_data, dict) and research_data.get("id"):
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

@app.route("/tindex/orb/start", methods=["POST"])
def start_orb_monitoring():
    """Start ORB monitoring - called by Supabase cron at 9:15 AM
    
    Query Parameters:
        debug (optional): Set to 'true' to bypass market hours check for testing
    """
    global ORB_SERVICE, ORB_TASK
    
    try:
        # Check for debug mode in query parameters or request body
        debug_mode = request.args.get('debug', '').lower() == 'true'
        if not debug_mode:
            # Also check request body for debug flag
            try:
                request_data = request.get_json(silent=True) or {}
                debug_mode = request_data.get('debug', False)
            except Exception as e:
                logger.error("Failed to retrieve request data: %s", e)

        
        with orb_lock:
            if ORB_SERVICE and ORB_SERVICE.is_running:
                return jsonify({"message": "ORB service already running"})
        
        # Get service instance
        ORB_SERVICE = get_alpaca_service()
        
        # Run in background thread
        def run_orb():
            if ORB_SERVICE is not None:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(ORB_SERVICE.start(debug_mode=debug_mode))                
        
        ORB_TASK = threading.Thread(target=run_orb, daemon=True)
        ORB_TASK.start()
        
        message = "ORB monitoring started"
        if debug_mode:
            message += " (DEBUG MODE: Market hours check bypassed)"
        
        return jsonify({
            "success": True,
            "message": message,
            "debug_mode": debug_mode
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

if __name__ == "__main__":
    app.run(debug=True)
