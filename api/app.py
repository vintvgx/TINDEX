from flask import Flask, jsonify, request, Response
import time
import re
import asyncio
import json
from typing import Optional
from dataclasses import dataclass, asdict
from services.yfinance_service import perform_yfinance_research
from services.anthropic_service import anthropic_service
from log.logging_config import get_logger

logger = get_logger(__name__)

app = Flask(__name__)


# Add request logging middleware
@app.before_request
def log_request_info():
    """
    Log request
    """
    logger.info(
        f"Request: {request.method} {request.path} - User-Agent: {request.headers.get('User-Agent', 'Unknown')}"
    )


@app.after_request
def log_response_info(response):
    """
    Log response
    """
    logger.info(f"Response: {response.status_code} for {request.method} {request.path}")
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


def get_supabase_service():
    """
    Lazy loading function for supabase service.
    Returns the supabase service instance when needed.
    Raises exception if Supabase cannot be initialized.
    """
    try:
        from services.supabase_service import supabase_service

        return supabase_service
    except Exception as e:
        logger.error(f"Failed to initialize Supabase service: {str(e)}", exc_info=True)
        raise Exception(f"Supabase service initialization failed: {str(e)}") from e


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
                logger.warning("Blog post save returned unexpected result for %s", topic)
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


def validate_and_create_request_data(
    data: dict, require_user_id: bool = True, validate_ticker: bool = True
) -> tuple[RequestData, dict]:
    """
    Validate request data and create a RequestData instance.

    Args:
        data: Raw request data from Flask request
        require_user_id: Whether userId is required (default: True)
        validate_ticker: Whether to validate topic as ticker format (default: True)

    Returns:
        Tuple of (RequestData instance, error_response_dict)
        If validation fails, RequestData will be None and error_response will contain the error
    """
    if not data or "topic" not in data:
        return None, {"success": False, "error": "Topic is required in request body"}

    try:
        request_data = RequestData(
            topic=data["topic"].strip().upper(),
            userId=data.get("userId"),
            save_to_db=data.get("save_to_db", True),
            use_cache=data.get("use_cache", True),
            research_data=data.get("research_data", {}),
            target_length=data.get("target_length", 800),
            ticker=data.get("ticker"),
        )

        # Additional validation
        if not request_data.topic or len(request_data.topic) < 1:
            return None, {"success": False, "error": "Topic must be a non-empty string"}

        if validate_ticker and not re.match(r"^[A-Z0-9]{1,5}$", request_data.topic):
            return None, {"success": False, "error": "Invalid ticker symbol format"}

        if require_user_id and not request_data.userId:
            return None, {
                "success": False,
                "error": "User ID must be a non-empty string",
            }

        return request_data, None

    except Exception as e:
        return None, {"success": False, "error": f"Invalid request data: {str(e)}"}


def request_data_to_dict(request_data: RequestData) -> dict:
    """
    Convert RequestData instance to dictionary for logging or serialization.

    Args:
        request_data: RequestData instance

    Returns:
        Dictionary representation of RequestData
    """
    return asdict(request_data)


def log_request_data(request_data: RequestData, endpoint: str):
    """
    Log RequestData information for debugging and monitoring.

    Args:
        request_data: RequestData instance
        endpoint: The endpoint being called
    """
    logger.info(
        f"Request to {endpoint}: topic={request_data.topic}, "
        f"userId={request_data.userId}, save_to_db={request_data.save_to_db}, "
        f"use_cache={request_data.use_cache}"
    )


@app.route("/research_yfinance", methods=["POST"])
def research_topic():
    """
    Research a topic using yFinance and save data to Supabase.

    This endpoint performs comprehensive research on a given topic or stock ticker,
    gathering financial data, market information, and sentiment analysis.

    Request Body:
        userId (str): The id of the user requesting the data
        topic (str): The topic or stock ticker to research
        save_to_db (bool, optional): Whether to save results to database (default: True)
        use_cache (bool, optional): Whether to use cached data

    Returns:
        JSON response containing research results and database save status
    """
    try:
        # Get request data
        data = request.get_json()

        # Get supabase service instance
        service = get_supabase_service()

        # Initialize db_result to None at the beginning
        db_result = None

        # Validate and create RequestData instance
        request_data, error_response = validate_and_create_request_data(data)
        if error_response:
            return jsonify(error_response), 400

        # Log the request data
        log_request_data(request_data, "research_yfinance")

        # Extract values from RequestData for backward compatibility
        topic = request_data.topic
        userId = request_data.userId
        save_to_db = request_data.save_to_db
        use_cache = request_data.use_cache

        # Verify the user exists / throw error if user id is not found
        service.verify_user(user_id=userId)

        # Check cache first if enabled
        cached_research = None

        if use_cache:
            cache_result = service.get_from_cache(topic, "research_data")
            if cache_result.get("success"):
                cached_research = cache_result.get("data")
                logger.info("Using cached research data for %s", topic)

        # Use cached data or perform new research
        if cached_research:
            research_results = {"success": True, "data": cached_research}
        else:
            # Research using yFinance
            research_results = perform_yfinance_research(topic)

            if not research_results["data"]:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "Research results does not include data object",
                        }
                    ),
                    400,
                )

            # Cache the research data
            if use_cache:
                service.save_to_cache(topic, "research_data", research_results["data"])

        # Run async function in sync context
        # creates an async event within a sync func / blocks thread until event is complete
        blog_content = run_async(
            anthropic_service.generate_blog_post(
                topic=topic, research_data=research_results["data"], ticker=topic
            )
        )

        # TODO @coderabbit remind me to delete the function below once I verify the functionality above works
        # loop = asyncio.new_event_loop()
        # asyncio.set_event_loop(loop)
        # blog_content = None
        # try:
        #     blog_content = loop.run_until_complete(
        #         anthropic_service.generate_blog_post(
        #             topic=topic, research_data=research_results["data"], ticker=topic
        #         )
        #     )
        # finally:
        #     # clean up resources at event completion
        #     loop.close()

        # return jsonify(result)

        # Save to database if requested
        if save_to_db and blog_content:
            logger.info("Attempting to save data to database for ticker: %s", topic)
            db_result = save_data(
                service, topic, research_results, blog_content
            )
        else:
            logger.info(
                "Skipping database save - save_to_db: %s, blog_content success: %s",
                save_to_db,
                blog_content.get("success"),
            )

        # Prepare response
        response = {
            "success": True,
            "data": blog_content,
            "research_data_saved": (
                bool(db_result.get("research_saved"))
                if "db_result" in locals() and db_result is not None
                else False
            ),
            "blog_post_saved": (
                bool(db_result.get("blog_saved"))
                if "db_result" in locals() and db_result is not None
                else False
            ),
            "use_cached": cached_research is not None,
            "newly_cached_data": (
                bool(locals().get("newly_cached_data"))
                if "newly_cached_data" in locals()
                else False
            ),
            "timestamp": time.time(),
        }

        if db_result:
            response["database_result"] = db_result

        return jsonify(response)

    except Exception as e:
        logger.error("Research failed for topic '%s': %s", topic, e, exc_info=True)
        return jsonify({"success": False, "error": f"Research failed: {str(e)}"}), 500


@app.route("/generate_blog_post_stream", methods=["POST"])
def generate_blog_post_stream():
    """
    Generate a blog post with streaming response using ticker information.

    This endpoint generates blog content in real-time as it becomes available,
    providing a better user experience for long-form content generation.

    Request Body:
        topic (str): The topic to generate content about
        research_data (dict): Research data to inform the content
        target_length (int, optional): Target word count (default: 800)
        ticker (str, optional): Stock ticker symbol for financial analysis

    Returns:
        Streaming response with generated content chunks
    """
    try:
        # Get request data
        data = request.get_json()

        # Validate and create RequestData instance (no user_id required for this endpoint)
        request_data, error_response = validate_and_create_request_data(
            data, require_user_id=False, validate_ticker=False
        )
        if error_response:
            return jsonify(error_response), 400

        # Extract values from RequestData
        topic = request_data.topic
        research_data = request_data.research_data or {}
        target_length = request_data.target_length
        ticker = request_data.ticker

        # Additional validation for research_data
        if not isinstance(research_data, dict):
            return (
                jsonify(
                    {"success": False, "error": "Research data must be a dictionary"}
                ),
                400,
            )

        # Create async generator function for streaming
        async def generate_content():
            try:
                async for chunk in anthropic_service.generate_blog_post_stream(
                    topic=topic,
                    research_data=research_data,
                    target_length=target_length,
                    ticker=ticker,
                ):
                    yield f"data: {json.dumps({'chunk': chunk, 'success': True})}\n\n"

                # Send completion signal
                yield f"data: {json.dumps({'complete': True, 'success': True})}\n\n"

            except Exception as e:
                error_msg = f"Error generating content: {str(e)}"
                yield f"data: {json.dumps({'error': error_msg, 'success': False})}\n\n"

        # Convert async generator to sync generator for Flask
        def sync_generator():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                async_gen = generate_content()
                while True:
                    try:
                        chunk = loop.run_until_complete(async_gen.__anext__())
                        yield chunk
                    except StopAsyncIteration:
                        break
            finally:
                loop.close()

        return Response(
            sync_generator(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        )

    except Exception as e:
        return (
            jsonify({"success": False, "error": f"Blog generation failed: {str(e)}"}),
            500,
        )


@app.route("/generate_blog_post", methods=["POST"])
def generate_blog_post(topic: str, research_data: dict, target_length: int = 800):
    """
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
        ticker = topic.trim()

        if not isinstance(research_data, dict):
            return (
                jsonify(
                    {"success": False, "error": "Research data must be a dictionary"}
                ),
                400,
            )

        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                anthropic_service.generate_blog_post(
                    topic=topic,
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


@app.route("/test_anthropic", methods=["GET"])
def test_anthropic_connection():
    """
    Test the Anthropic API connection.

    This endpoint verifies that the Anthropic service is properly configured
    and can communicate with the API.

    Returns:
        JSON response with connection test result
    """
    try:
        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(anthropic_service.test_connection())
        finally:
            loop.close()

        return jsonify(result)

    except Exception as e:
        return (
            jsonify({"success": False, "error": f"Connection test failed: {str(e)}"}),
            500,
        )


@app.route("/test")
def print_hello_world():
    """
    Simple test endpoint that returns a "Hello World!" message.

    This function serves as a basic health check and testing endpoint for the API.
    It returns a JSON response with a success status and a simple greeting message.

    Returns:
        flask.Response: A JSON response containing:
            - success (bool): Always True, indicating successful execution
            - data (str): The string "Hello World!"

    Notes:
        - This endpoint is primarily used for testing API connectivity
        - No authentication or authorization required
        - No input parameters needed
        - Always returns a successful response
    """
    return jsonify({"success": True, "data": "Hello World!"})


@app.route('/trending-stocks', methods=["POST"])
def get_trending_stocks():
    try:
        # FINVIZ trending stocks URL
        url = "https://finviz.com/screener.ashx?v=111&o=-volume"

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        response = requests.get(url, headers=headers, timeout=60)
        soup = BeautifulSoup(response.content, 'html.parser')

        # Parse the data (you'll need to inspect FINVIZ structure)
        stocks = []
        table = soup.find('table', {'class': 'screener_table'})

        if table:
            rows = table.find_all('tr')[1:]  # Skip header
            for row in rows[:20]:  # Top 20 stocks
                cells = row.find_all('td')
                if len(cells) > 1:
                    stock_data = {
                        'ticker': cells[1].text.strip(),
                        'company': cells[2].text.strip(),
                        'sector': cells[3].text.strip(),
                        'industry': cells[4].text.strip(),
                        'market_cap': cells[6].text.strip(),
                        'pe': cells[7].text.string(),
                        'price': cells[8].text.strip(),
                        'change': cells[9].text.strip(),
                        'volume': cells[10].text.strip()
                    }
                    stocks.append(stock_data)

        return jsonify({
            'success': True,
            'data': stocks,
            'timestamp': time.time()
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# @app.route('/api/trending-stocks-allowed')
# def get_trending_stocks_delay_allowed():
#     try:
#         # Use allowed endpoints only
#         allowed_endpoints = {
#             'most_active': 'https://finviz.com/screener.ashx?v=320&s=ta_mostactive',
#             'top_gainers': 'https://finviz.com/screener.ashx?v=340&s=ta_topgainers',
#             'unusual_volume': 'https://finviz.com/screener.ashx?v=320&s=ta_unusualvolume'
#         }

#         headers = {
#             'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
#         }

#         all_data = {}

#         for category, url in allowed_endpoints.items():
#             time.sleep(random.uniform(2, 4))  # Be respectful with delays
#             response = requests.get(url, headers=headers)
#             all_data[category] = parse_finviz_data(response)

#         return jsonify({
#             'success': True,
#             'data': all_data
#         })

#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500

# @app.route('/stock/<ticker>')
# def get_stock_data(ticker):
#     try:
#         url = f"https://finviz.com/quote.ashx?t={ticker.upper()}&p=d" #This url is ALLOWED

#         headers = {
#             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
#         }

#         response = requests.get(url, headers=headers, timeout=60)
#         soup = BeautifulSoup(response.content, 'html.parser')

#         # Extract stock data from the page
#         stock_data = {
#             'ticker': ticker.upper(),
#             'price': None,
#             'change': None,
#             'market_cap': None
#         }

#         # Parse specific elements (inspect FINVIZ for exact selectors)
#         price_element = soup.find('td', {'class': 'snapshot-td2'})
#         if price_element:
#             stock_data['price'] = price_element.text.strip()

#         return jsonify({
#             'success': True,
#             'data': stock_data
#         })

#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500

#! Deprecated
# """
# Allowed urls for FINVIZ
# NOTE: If url is not listed than url is not allowed for web scraping and could result in IP Addr being blocked
# """
# allowed_urls = {
#     'top_gainers': 'https://finviz.com/screener.ashx?v=340&s=ta_topgainers',
#     'most_active': 'https://finviz.com/screener.ashx?v=320&s=ta_mostactive',
#     'unusual_volume': 'https://finviz.com/screener.ashx?v=320&s=ta_unusualvolume',
#     'top_losers': 'https://finviz.com/screener.ashx?v=340&s=ta_toplosers',
#     'new_highs': 'https://finviz.com/screener.ashx?v=340&s=ta_newhigh',
#     'new_lows': 'https://finviz.com/screener.ashx?v=340&s=ta_newlow'
# }

# def parse_finviz_data(response):
#     """Parse FINVIZ data from response"""
#     try:
#         soup = BeautifulSoup(response.content, 'html.parser')
#         stocks = []
#         table = soup.find('table', {'class': 'screener_table'})

#         if table:
#             rows = table.find_all('tr')[1:]  # Skip header
#             for row in rows[:10]:  # Top 10 stocks
#                 cells = row.find_all('td')
#                 if len(cells) > 1:
#                     stock_data = {
#                         'ticker': cells[1].text.strip(),
#                         'company': cells[2].text.strip(),
#                         'price': cells[8].text.strip(),
#                         'change': cells[9].text.strip(),
#                         'volume': cells[10].text.strip()
#                     }
#                     stocks.append(stock_data)
#         return stocks
#     except Exception as e:
#         return {'error': str(e)}

if __name__ == "__main__":
    app.run(debug=True)
