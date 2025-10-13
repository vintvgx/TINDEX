import time
import re
import asyncio
import json
from typing import Optional
from dataclasses import dataclass, asdict

from bs4 import BeautifulSoup

from flask import Flask, jsonify, request, Response # pylint: disable=import-error # type: ignore

import requests
from services.yfinance_service import perform_yfinance_research
from services.anthropic_service import anthropic_service
from log.logging_config import get_logger
from utils.cache import TrendingStocksCache

# Services 
from services.watchlist_service import get_watchlist_service
from services.yahoo_watchlist_service import get_yahoo_watchlist_service
from services.supabase_service import get_supabase_service
from services.research_service import get_research_service
from services.blog_generation_service import get_blog_service





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

            # Verify the user exists / throw error if user id is not found
            service.verify_user(user_id=user_id)

            # Get research data using the service layer
            research_result = research_service.get_research_data(
                ticker=ticker,
                use_cache=use_cache,
                save_to_db=save_to_db
            )

            if not research_result["success"]:
                return jsonify(research_result), 400

        return jsonify(research_result)

    except Exception as e:
        logger.error("Ticker research failed for ticker '%s': %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": f"Research failed: {str(e)}"}), 500

    
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
            target_length=target_length
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


def save_data(service, topic, research_results, blog_content):
    """
    Save research data and blog post to database.

    Args:
        service: Supabase service instance
        topic: Stock ticker
        research_results: Research data from yFinance
        blog_content: Generated blog content

    Returns:
        Dict containing save results and IDs
    """
    db_result = None
    stock_research_id = None
    research_db_result = None
    blog_db_result = None

    # Attempt to save stock research data
    try:
        stock_research = research_results["data"]
        logger.info("Saving stock research data for %s", topic)
        research_db_result = service.save_stock_research(stock_research)

        # Extract the research ID if save was successful
        if research_db_result and research_db_result.get("data", {}).get("id"):
            stock_research_id = research_db_result["data"]["id"]

            logger.info(
                "Stock research saved successfully with ID: %s", stock_research_id
            )
        else:
            logger.warning("Stock research save returned no ID for %s", topic)

    except Exception as e:
        logger.error("Failed to save stock research data for %s: %s", topic, str(e))

    # Save blog post
    try:
        # verify blog post contains the expected fields
        can_save_blog = (
            isinstance(blog_content, dict)
            and bool(blog_content.get("title"))
            and bool(blog_content.get("content"))
        )

        if not can_save_blog:
            logger.warning("Skipping blog save: missing title/content for %s", topic)
            blog_db_result = {"success": False, "error": "Missing title/content"}
        else:
            # Set stock_research_id in blog_content (will be None if research save failed)
            blog_content["stock_research_id"] = stock_research_id
            blog_content["status"] = "published"

            logger.info(
                "Saving blog post for %s with stock_research_id: %s",
                topic,
                stock_research_id,
            )
            blog_db_result = service.save_blog_post(blog_content)

            if blog_db_result and blog_db_result.get("success"):
                logger.info("Blog post saved successfully for %s", topic)
            else:
                logger.warning(
                    "Blog post save returned unexpected result for %s", topic
                )
    except Exception as e:
        logger.error("Failed to save blog post for %s: %s", topic, str(e))

    db_result = {
        "research_saved": (
            research_db_result.get("success", False) if research_db_result else False
        ),
        "blog_saved": blog_db_result.get("success", False) if blog_db_result else False,
        "research_id": stock_research_id,
        "blog_id": (
            blog_db_result.get("data", {}).get("id")
            if blog_db_result and blog_db_result.get("success")
            else None
        ),
    }
    return db_result


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
            topic=ticker,  # Use ticker from URL as topic
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

#TODO include once MVP app is complete and real time data is being used within UI
# @app.route("/generate_blog_post_stream", methods=["POST"])
# def generate_blog_post_stream():
#     """
#     Generate a blog post with streaming response using ticker information.

#     This endpoint generates blog content in real-time as it becomes available,
#     providing a better user experience for long-form content generation.

#     Request Body:
#         topic (str): The topic to generate content about
#         research_data (dict): Research data to inform the content
#         target_length (int, optional): Target word count (default: 800)
#         ticker (str, optional): Stock ticker symbol for financial analysis

#     Returns:
#         Streaming response with generated content chunks
#     """
#     try:
#         # Get request data
#         data = request.get_json()

#         # Validate and create RequestData instance (no user_id required for this endpoint)
#         request_data, error_response = validate_and_create_request_data(
#             data, require_user_id=False, validate_ticker=False
#         )
#         if error_response:
#             return jsonify(error_response), 400

#         # Extract values from RequestData
#         topic = request_data.topic
#         research_data = request_data.research_data or {}
#         target_length = request_data.target_length
#         ticker = request_data.ticker

#         # Additional validation for research_data
#         if not isinstance(research_data, dict):
#             return (
#                 jsonify(
#                     {"success": False, "error": "Research data must be a dictionary"}
#                 ),
#                 400,
#             )

#         # Create async generator function for streaming
#         async def generate_content():
#             try:
#                 async for chunk in anthropic_service.generate_blog_post_stream(
#                     topic=topic,
#                     research_data=research_data,
#                     target_length=target_length,
#                     ticker=ticker,
#                 ):
#                     yield f"data: {json.dumps({'chunk': chunk, 'success': True})}\n\n"

#                 # Send completion signal
#                 yield f"data: {json.dumps({'complete': True, 'success': True})}\n\n"

#             except Exception as e:
#                 error_msg = f"Error generating content: {str(e)}"
#                 yield f"data: {json.dumps({'error': error_msg, 'success': False})}\n\n"

#         # Convert async generator to sync generator for Flask
#         def sync_generator():
#             loop = asyncio.new_event_loop()
#             asyncio.set_event_loop(loop)
#             try:
#                 async_gen = generate_content()
#                 while True:
#                     try:
#                         chunk = loop.run_until_complete(async_gen.__anext__())
#                         yield chunk
#                     except StopAsyncIteration:
#                         break
#             finally:
#                 loop.close()

#         return Response(
#             sync_generator(),
#             mimetype="text/event-stream",
#             headers={
#                 "Cache-Control": "no-cache",
#                 "Connection": "keep-alive",
#                 "Access-Control-Allow-Origin": "*",
#                 "Access-Control-Allow-Headers": "Content-Type",
#             },
#         )

#     except Exception as e:
#         return (
#             jsonify({"success": False, "error": f"Blog generation failed: {str(e)}"}),
#             500,
#         )


@app.route("/generate_blog_post/<ticker>", methods=["POST"])
def generate_blog_post(ticker: str, target_length: int = 800):
    """
    TODO add request validation to function (validate user id)
    Generate a complete blog post without streaming.

    This endpoint generates the full blog post content and returns it in a single response.
    Useful for shorter content or when streaming is not needed.

    Request Body:
        topic (str): The topic to generate content about
        research_data (dict): Research data to inform the content
        target_length (int, optional): Target word count (default: 800)
        ticker (str, optional): Stock ticker symbol for financial analysis

    Returns:
        JSON response containing the complete blog post
    """
    try:
        # Validate ticker from URL path
        ticker = ticker.strip().upper()
        
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({
                "success": False,
                "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."
            }), 400
            
        # Get research service instance
        research_service = get_research_service()
        
        # Get research data using the service layer
        research_data = research_service.get_research_data(
            ticker=ticker,
            use_cache=True,
            save_to_db=True
        )

        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                anthropic_service.generate_blog_post(
                    topic=ticker,
                    research_data=research_data,
                    target_length=target_length,
                    ticker=ticker,
                )
            )
        finally:
            loop.close()

        return jsonify(result)

    except Exception as e:
        return (
            jsonify({"success": False, "error": f"Blog generation failed: {str(e)}"}),
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


if __name__ == "__main__":
    app.run(debug=True)
