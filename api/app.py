from flask import Flask, jsonify, request
import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
from urllib.parse import urlencode
import supabase
import random

import logging
from services.supabase_service import supabase_service, ResearchTopic, StockData
from services.yfinance_service import perform_yfinance_research

# Configure logging
logger = logging.getLogger(__name__)

app = Flask(__name__)

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
        save_to_db = data.get('save_to_db', True)
        
        # Validate topic
        # TODO validate user id
        if not topic or len(topic) < 1:
            return jsonify({
                'success': False,
                'error': 'Topic must be a non-empty string'
            }), 400
        
        # Research using yFinance
        research_results = perform_yfinance_research(topic)
        
        if not research_results['success']:
            return jsonify(research_results), 500
        
        # Save to database if requested
        # TODO update to save to databsae accordingly
        db_result = None
        if save_to_db:
            db_result = save_research_to_database(topic, research_results['data'])
        
        # Prepare response
        response = {
            'success': True,
            'topic': topic,
            'research_data': research_results['data'],
            'database_saved': save_to_db,
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

def convert_dataframe_to_json(df):
    """
    Convert pandas DataFrame to JSON-serializable format.
    
    Args:
        df: pandas DataFrame or None
        
    Returns:
        List of dictionaries or empty list if DataFrame is None/empty
    """
    if df is None or df.empty:
        return []
    
    try:
        # Convert DataFrame to list of dictionaries
        return df.to_dict('records')
    except Exception:
        # Fallback: convert to list of lists with column names
        try:
            return df.values.tolist()
        except Exception:
            return []



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
        
        # Save to database
        result = supabase_service.save_research_topic(research_topic)
        
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to save to database: {str(e)}'
        }

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

