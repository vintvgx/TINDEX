from flask import Flask, jsonify, request, Response, stream_template
import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
from urllib.parse import urlencode
import re
import supabase
import random
import asyncio
import json

import logging
from services.supabase_service import ResearchTopic, StockData
from services.yfinance_service import perform_yfinance_research
from services.anthropic_service import anthropic_service

# Configure logging
logger = logging.getLogger(__name__)

app = Flask(__name__)

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

@app.route('/research_yfinance', methods=['POST'])
def research_topic():
    """
    Research a topic using yFinance and save data to Supabase.
    
    This endpoint performs comprehensive research on a given topic or stock ticker,
    gathering financial data, market information, and sentiment analysis.
    
    Request Body:
        userId (str): The id of the user requesting the data
        topic (str): The topic or stock ticker to research
        TODO? : save_to_db (bool, optional): Whether to save results to database (default: True)
    
    Returns:
        JSON response containing research results and database save status
    """
    try:
        # Get request data
        data = request.get_json()
        
        # TODO update to verify user id
        if not data or 'topic' not in data: 
            return jsonify({
                'success': False,
                'error': 'Topic is required in request body'
            }), 400
        
        topic = data['topic'].strip().upper()
        userId = data.get('userId')
        save_to_db = data.get('save_to_db', True)
        
        # Validate topic
        if not topic or len(topic) < 1:
            return jsonify({
                'success': False,
                'error': 'Topic must be a non-empty string'
            }), 400
        if not re.match(r'^[A-Z0-9]{1,5}$', topic):
            logger.warning(f"Topic '{topic}' may not be a valid ticker symbol")
            return jsonify({
                'success': False,
                'error': 'iNVALID TICKER SYMBOL!'
            }), 400
    
        # Get supabase service instance
        service = get_supabase_service()
  
        # TODO include after api testing
        # if not userId:
        #     logger.warning(f"User id '{userId}' can not be null")
        #     return jsonify({
        #         'success': False,
        #         'error': 'User ID must be a non-empty string'
        #     }), 400
        # else: 
        #     # Verify the user exists / throw error if user id is not found
        #     service.verify_user(user_id=userId)

        # Research using yFinance
        research_results = perform_yfinance_research(topic)
                
        if not research_results['success']:
            return jsonify(research_results), 500
        
        if not research_results['data']:
            return jsonify({
                'success': False,
                'error': 'Research results does not include data object'
            }), 400
            
        blog_content = generate_blog_post(topic, research_results)
        
        # Save to database if requested
        # TODO update to save to database accordingly
        db_result = None
        if save_to_db:
            db_result = save_research_to_database(topic, research_results['data'])
        
        # Prepare response
        response = {
            'success': True,
            # 'topic': topic,
            'data': blog_content,
            # 'research_data': research_results['data'],
            'saved_to_DB': bool(save_to_db and db_result and db_result.get('success') is True), # Return True if successfully saved, otherwise False
            'timestamp': time.time()
        }
        
        if db_result:
            response['database_result'] = db_result
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Research failed: {str(e)}'
        }), 500

def save_research_to_database(topic: str, research_data: dict) -> dict:
    """
    Save research data to Supabase database.
    
    Args:
        topic: The research topic
        research_data: The research data to save
        
    Returns:
        Dict containing save operation result
    """
    try:
        # Get supabase service instance
        service = get_supabase_service()
        
        # Create ResearchTopic object
        research_topic = ResearchTopic(
            topic=topic,
            ticker=research_data.get('ticker'),
            description=research_data.get('description'),
            sentiment=research_data.get('sentiment', {}).get('sentiment') if research_data.get('sentiment') else None,
            confidence_score=research_data.get('sentiment', {}).get('confidence') if research_data.get('sentiment') else None,
            market_cap=research_data.get('market_cap'),
            current_price=research_data.get('current_price'),
            price_change=research_data.get('price_change'),
            volume=research_data.get('volume'),
            pe_ratio=research_data.get('pe_ratio'),
            dividend_yield=research_data.get('dividend_yield'),
            beta=research_data.get('beta'),
            sector=research_data.get('sector'),
            industry=research_data.get('industry')
        )
        
        # Save to database using the service instance
        result = service.save_research_topic(research_topic)
        
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to save to database: {str(e)}'
        }

@app.route('/generate_blog_post_stream', methods=['POST'])
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
        
        if not data or 'topic' not in data:
            return jsonify({
                'success': False,
                'error': 'Topic is required in request body'
            }), 400
        
        topic = data['topic'].strip()
        research_data = data.get('research_data', {})
        target_length = data.get('target_length', 800)
        ticker = data.get('ticker')
        
        # Validate inputs
        if not topic or len(topic) < 1:
            return jsonify({
                'success': False,
                'error': 'Topic must be a non-empty string'
            }), 400
        
        if not isinstance(research_data, dict):
            return jsonify({
                'success': False,
                'error': 'Research data must be a dictionary'
            }), 400
        
        # Create async generator function for streaming
        async def generate_content():
            try:
                async for chunk in anthropic_service.generate_blog_post_stream(
                    topic=topic,
                    research_data=research_data,
                    target_length=target_length,
                    ticker=ticker
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
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
            }
        )
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Blog generation failed: {str(e)}'
        }), 500

@app.route('/generate_blog_post', methods=['POST'])
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
            return jsonify({
                'success': False,
                'error': 'Research data must be a dictionary'
            }), 400
        
        # Run async function in sync context
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                anthropic_service.generate_blog_post(
                    topic=topic,
                    research_data=research_data,
                    target_length=target_length,
                    ticker=ticker
                )
            )
        finally:
            loop.close()
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Blog generation failed: {str(e)}'
        }), 500

@app.route('/test_anthropic', methods=['GET'])
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
        return jsonify({
            'success': False,
            'error': f'Connection test failed: {str(e)}'
        }), 500

@app.route('/test')
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
    return jsonify({
        'success': True,
        'data': 'Hello World!'
    })
    

# @app.route('/trending-stocks')
# def get_trending_stocks():
#     try:
#         # FINVIZ trending stocks URL
#         url = "https://finviz.com/screener.ashx?v=111&o=-volume"
        
#         headers = {
#             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
#         }
        
#         response = requests.get(url, headers=headers, timeout=60)
#         soup = BeautifulSoup(response.content, 'html.parser')
        
#         # Parse the data (you'll need to inspect FINVIZ structure)
#         stocks = []
#         table = soup.find('table', {'class': 'screener_table'})
        
#         if table:
#             rows = table.find_all('tr')[1:]  # Skip header
#             for row in rows[:20]:  # Top 20 stocks
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
        
#         return jsonify({
#             'success': True,
#             'data': stocks,
#             'timestamp': time.time()
#         })
        
#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500
        
        
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

if __name__ == '__main__':
    app.run(debug=True)