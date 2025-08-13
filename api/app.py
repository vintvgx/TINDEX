from flask import Flask, jsonify, request
import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
from urllib.parse import urlencode
import supabase
import random
import yfinance as yf
from supabase_service import supabase_service, ResearchTopic, StockData

app = Flask(__name__)

"""
Allowed urls for FINVIZ 
NOTE: If url is not listed than url is not allowed for web scraping and could result in IP Addr being blocked
"""
allowed_urls = {
    'top_gainers': 'https://finviz.com/screener.ashx?v=340&s=ta_topgainers',
    'most_active': 'https://finviz.com/screener.ashx?v=320&s=ta_mostactive',
    'unusual_volume': 'https://finviz.com/screener.ashx?v=320&s=ta_unusualvolume',
    'top_losers': 'https://finviz.com/screener.ashx?v=340&s=ta_toplosers',
    'new_highs': 'https://finviz.com/screener.ashx?v=340&s=ta_newhigh',
    'new_lows': 'https://finviz.com/screener.ashx?v=340&s=ta_newlow'
}

def parse_finviz_data(response):
    """Parse FINVIZ data from response"""
    try:
        soup = BeautifulSoup(response.content, 'html.parser')
        stocks = []
        table = soup.find('table', {'class': 'screener_table'})
        
        if table:
            rows = table.find_all('tr')[1:]  # Skip header
            for row in rows[:10]:  # Top 10 stocks
                cells = row.find_all('td')
                if len(cells) > 1:
                    stock_data = {
                        'ticker': cells[1].text.strip(),
                        'company': cells[2].text.strip(),
                        'price': cells[8].text.strip(),
                        'change': cells[9].text.strip(),
                        'volume': cells[10].text.strip()
                    }
                    stocks.append(stock_data)
        return stocks
    except Exception as e:
        return {'error': str(e)}

@app.route('/research_topic', methods=['POST'])
def research_topic():
    """
    Research a topic using yFinance and save data to Supabase.
    
    This endpoint performs comprehensive research on a given topic or stock ticker,
    gathering financial data, market information, and sentiment analysis.
    
    Request Body:
        userId (str): The id of the user requesting the data
        topic (str): The topic or stock ticker to research
        TODO? : include_sentiment (bool, optional): Whether to include sentiment analysis
        TODO? : save_to_db (bool, optional): Whether to save results to database (default: True)
    
    Returns:
        JSON response containing research results and database save status
    """
    try:
        # Get request data
        data = request.get_json()
        
        if not data or 'topic' not in data:
            return jsonify({
                'success': False,
                'error': 'Topic is required in request body'
            }), 400
        
        topic = data['topic'].strip().upper()
        include_sentiment = data.get('include_sentiment', False)
        save_to_db = data.get('save_to_db', True)
        
        # Validate topic
        if not topic or len(topic) < 1:
            return jsonify({
                'success': False,
                'error': 'Topic must be a non-empty string'
            }), 400
        
        # Research using yFinance
        research_results = perform_yfinance_research(topic, include_sentiment)
        
        if not research_results['success']:
            return jsonify(research_results), 500
        
        # Save to database if requested
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

def perform_yfinance_research(topic: str, include_sentiment: bool = False) -> dict:
    """
    Perform comprehensive research using yFinance.
    
    Args:
        topic: The topic or ticker to research
        include_sentiment: Whether to include sentiment analysis
        
    Returns:
        Dict containing research results
    """
    try:
        # Try to get stock info
        ticker = yf.Ticker(topic)
        
        # Get basic info
        info = ticker.info
        
        # Get historical data
        hist = ticker.history(period="1mo")
        
        # Get current price and change
        current_price = info.get('currentPrice', 0)
        previous_close = info.get('previousClose', current_price)
        price_change = current_price - previous_close
        price_change_percent = (price_change / previous_close * 100) if previous_close else 0
        
        # Prepare research data
        research_data = {
            'ticker': topic,
            'company_name': info.get('longName', info.get('shortName', topic)),
            'current_price': current_price,
            'price_change': round(price_change, 2),
            'price_change_percent': round(price_change_percent, 2),
            'volume': info.get('volume', 0),
            'market_cap': info.get('marketCap'),
            'pe_ratio': info.get('trailingPE'),
            'dividend_yield': info.get('dividendYield'),
            'beta': info.get('beta'),
            'sector': info.get('sector'),
            'industry': info.get('industry'),
            'description': info.get('longBusinessSummary', ''),
            'website': info.get('website'),
            'employees': info.get('fullTimeEmployees'),
            'country': info.get('country'),
            'currency': info.get('currency'),
            'exchange': info.get('exchange'),
            'market_state': info.get('marketState'),
            'regular_market_price': info.get('regularMarketPrice'),
            'regular_market_volume': info.get('regularMarketVolume'),
            'average_volume': info.get('averageVolume'),
            'day_high': info.get('dayHigh'),
            'day_low': info.get('dayLow'),
            'year_high': info.get('fiftyTwoWeekHigh'),
            'year_low': info.get('fiftyTwoWeekLow'),
            'price_to_book': info.get('priceToBook'),
            'debt_to_equity': info.get('debtToEquity'),
            'return_on_equity': info.get('returnOnEquity'),
            'profit_margins': info.get('profitMargins'),
            'revenue_growth': info.get('revenueGrowth'),
            'earnings_growth': info.get('earningsGrowth'),
            'historical_data': {
                'dates': hist.index.strftime('%Y-%m-%d').tolist() if not hist.empty else [],
                'prices': hist['Close'].tolist() if not hist.empty else [],
                'volumes': hist['Volume'].tolist() if not hist.empty else []
            }
        }
        
        # Add sentiment analysis if requested
        if include_sentiment:
            sentiment = analyze_sentiment(research_data)
            research_data['sentiment'] = sentiment
        
        return {
            'success': True,
            'data': research_data
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'yFinance research failed: {str(e)}'
        }

def analyze_sentiment(research_data: dict) -> dict:
    """
    Perform basic sentiment analysis on research data.
    
    Args:
        research_data: The research data to analyze
        
    Returns:
        Dict containing sentiment analysis results
    """
    try:
        # Simple sentiment analysis based on price movement and metrics
        price_change_percent = research_data.get('price_change_percent', 0)
        pe_ratio = research_data.get('pe_ratio')
        beta = research_data.get('beta')
        
        # Calculate sentiment score
        sentiment_score = 0
        
        # Price movement sentiment
        if price_change_percent > 5:
            sentiment_score += 2
        elif price_change_percent > 0:
            sentiment_score += 1
        elif price_change_percent < -5:
            sentiment_score -= 2
        elif price_change_percent < 0:
            sentiment_score -= 1
        
        # PE ratio sentiment (lower is generally better)
        if pe_ratio and pe_ratio < 15:
            sentiment_score += 1
        elif pe_ratio and pe_ratio > 25:
            sentiment_score -= 1
        
        # Beta sentiment (lower beta = less volatile)
        if beta and beta < 1:
            sentiment_score += 1
        elif beta and beta > 1.5:
            sentiment_score -= 1
        
        # Determine sentiment category
        if sentiment_score >= 2:
            sentiment = 'bullish'
        elif sentiment_score >= 0:
            sentiment = 'neutral'
        else:
            sentiment = 'bearish'
        
        return {
            'score': sentiment_score,
            'sentiment': sentiment,
            'confidence': min(abs(sentiment_score) / 4 * 100, 100),
            'factors': {
                'price_movement': price_change_percent,
                'pe_ratio': pe_ratio,
                'beta': beta
            }
        }
        
    except Exception as e:
        return {
            'score': 0,
            'sentiment': 'neutral',
            'confidence': 0,
            'error': str(e)
        }

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

@app.route('/trending-stocks')
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
        
        
@app.route('/api/trending-stocks-allowed')
def get_trending_stocks_delay_allowed():
    try:
        # Use allowed endpoints only
        allowed_endpoints = {
            'most_active': 'https://finviz.com/screener.ashx?v=320&s=ta_mostactive',
            'top_gainers': 'https://finviz.com/screener.ashx?v=340&s=ta_topgainers',
            'unusual_volume': 'https://finviz.com/screener.ashx?v=320&s=ta_unusualvolume'
        }
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        all_data = {}
        
        for category, url in allowed_endpoints.items():
            time.sleep(random.uniform(2, 4))  # Be respectful with delays
            response = requests.get(url, headers=headers)
            all_data[category] = parse_finviz_data(response)
        
        return jsonify({
            'success': True,
            'data': all_data
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/stock/<ticker>')
def get_stock_data(ticker):
    try:
        url = f"https://finviz.com/quote.ashx?t={ticker.upper()}&p=d" #This url is ALLOWED
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=60)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Extract stock data from the page
        stock_data = {
            'ticker': ticker.upper(),
            'price': None,
            'change': None,
            'market_cap': None
        }
        
        # Parse specific elements (inspect FINVIZ for exact selectors)
        price_element = soup.find('td', {'class': 'snapshot-td2'})
        if price_element:
            stock_data['price'] = price_element.text.strip()
            
        return jsonify({
            'success': True,
            'data': stock_data
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True)